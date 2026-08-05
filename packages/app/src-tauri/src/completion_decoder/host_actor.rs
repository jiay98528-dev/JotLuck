use super::worker::validate_generate_request;
use super::*;

pub(super) fn warmup_runtime(
    runtime: &Arc<Mutex<Option<RuntimeHandle>>>,
    request: CompletionDecoderWarmupRequest,
) -> Result<CompletionDecoderReadyResponse, String> {
    if request.protocol_version != PROTOCOL_VERSION {
        return Err("completion decoder protocol version mismatch".to_string());
    }
    let manifest_path = PathBuf::from(&request.manifest_path)
        .canonicalize()
        .map_err(|error| format!("unable to resolve completion decoder manifest: {error}"))?;
    let loaded = load_candidate(&manifest_path)?;
    if loaded.manifest.evaluation_only {
        if !evaluation_runtime_allowed() {
            return Err("completion decoder is restricted to dev/E2E evaluation".to_string());
        }
        validate_evaluation_manifest_path(&manifest_path)?;
    } else {
        validate_canonical_manifest_path(&manifest_path)?;
    }
    if loaded.manifest.candidate_id != request.expected_candidate_id {
        return Err("completion decoder candidate identity mismatch".to_string());
    }

    let mut guard = runtime
        .lock()
        .map_err(|_| "completion decoder state lock poisoned".to_string())?;
    if let Some(current) = guard.as_ref() {
        if current.ready.candidate_id == request.expected_candidate_id {
            return Ok(current.ready.clone());
        }
    }
    guard.take();
    let next = spawn_runtime(loaded)?;
    let ready = next.ready.clone();
    *guard = Some(next);
    Ok(ready)
}

pub(super) fn generate_with_runtime(
    runtime: &Arc<Mutex<Option<RuntimeHandle>>>,
    request: CompletionDecoderGenerateCommand,
) -> Result<CompletionDecoderGenerateEnvelope, String> {
    validate_generate_request(&request.request)?;
    let command_tx = runtime
        .lock()
        .map_err(|_| "completion decoder state lock poisoned".to_string())?
        .as_ref()
        .ok_or_else(|| "completion decoder is not warmed".to_string())?
        .command_tx
        .clone();
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    command_tx
        .send(ActorCommand::Generate {
            command: Box::new(request.clone()),
            response: response_tx,
        })
        .map_err(|_| "completion decoder worker is unavailable".to_string())?;
    let remaining = request.request.deadline_at.saturating_sub(now_unix_ms());
    if remaining == 0 {
        let _ = command_tx.send(ActorCommand::Cancel(request.request_id));
        return Err("completion decoder deadline expired".to_string());
    }
    response_rx
        .recv_timeout(Duration::from_millis(remaining).saturating_add(RESPONSE_GRACE))
        .map_err(|_| {
            let _ = command_tx.send(ActorCommand::Cancel(request.request_id));
            "completion decoder deadline expired".to_string()
        })?
}

pub(super) fn spawn_runtime(candidate: LoadedCandidate) -> Result<RuntimeHandle, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("unable to locate JotLuck executable: {error}"))?;
    let mut command = Command::new(executable);
    command
        .arg(WORKER_ARGUMENT)
        .arg(&candidate.manifest_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_worker_command(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("unable to start completion worker: {error}"))?;
    let windows_job = match assign_worker_limits(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            return Err(error);
        }
    };
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "completion worker stdin is unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "completion worker stdout is unavailable".to_string())?;
    let mut reader = BufReader::new(stdout);
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = ready_tx.send((read_frame::<WorkerFrame>(&mut reader), reader));
    });
    let (ready_frame, reader) = match ready_rx.recv_timeout(WARMUP_TIMEOUT) {
        Ok((Ok(frame), reader)) => (frame, reader),
        Ok((Err(error), _)) => {
            let _ = child.kill();
            return Err(format!("completion worker warmup protocol failed: {error}"));
        }
        Err(_) => {
            let _ = child.kill();
            return Err("completion worker warmup timed out".to_string());
        }
    };
    let ready = match ready_frame.event {
        WorkerEvent::Ready(ready) if ready_frame.protocol_version == PROTOCOL_VERSION => ready,
        WorkerEvent::Error { message, .. } => {
            let _ = child.kill();
            return Err(message);
        }
        _ => {
            let _ = child.kill();
            return Err("completion worker returned an invalid warmup frame".to_string());
        }
    };
    validate_ready_response(&ready, &candidate, child.id())?;

    let (worker_response_tx, worker_response_rx) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = reader;
        loop {
            match read_frame::<WorkerFrame>(&mut reader) {
                Ok(frame) => {
                    if worker_response_tx.send(Ok(frame)).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    let _ = worker_response_tx.send(Err(error.to_string()));
                    break;
                }
            }
        }
    });
    let (command_tx, command_rx) = mpsc::channel();
    thread::spawn(move || {
        run_runtime_actor(child, stdin, windows_job, command_rx, worker_response_rx)
    });
    Ok(RuntimeHandle { command_tx, ready })
}

pub(super) fn run_runtime_actor(
    mut child: Child,
    stdin: ChildStdin,
    _windows_job: Option<WindowsJobHandle>,
    command_rx: mpsc::Receiver<ActorCommand>,
    worker_response_rx: mpsc::Receiver<Result<WorkerFrame, String>>,
) {
    let mut writer = BufWriter::new(stdin);
    let mut active: Option<ActiveRequest> = None;
    loop {
        while let Ok(frame) = worker_response_rx.try_recv() {
            match frame {
                Ok(frame) => settle_worker_frame(frame, &mut active),
                Err(error) => {
                    settle_worker_failure(&error, &mut active);
                    let _ = child.kill();
                    return;
                }
            }
        }
        if let Some((request_id, deadline_at, _)) = active.as_ref() {
            if now_unix_ms() > *deadline_at {
                let request_id = *request_id;
                let _ = write_frame(
                    &mut writer,
                    &HostFrame {
                        protocol_version: PROTOCOL_VERSION,
                        request_id,
                        command: HostCommand::Cancel,
                    },
                );
                if let Some((_, _, response)) = active.take() {
                    let _ = response.send(Err("completion decoder deadline expired".to_string()));
                }
            }
        }
        match command_rx.recv_timeout(ACTOR_POLL_INTERVAL) {
            Ok(ActorCommand::Generate { command, response }) => {
                let command = *command;
                if let Some((previous_id, _, previous_response)) = active.take() {
                    let _ = write_frame(
                        &mut writer,
                        &HostFrame {
                            protocol_version: PROTOCOL_VERSION,
                            request_id: previous_id,
                            command: HostCommand::Cancel,
                        },
                    );
                    let _ = previous_response
                        .send(Err("completion decoder request was superseded".to_string()));
                }
                let request_id = command.request_id;
                let deadline_at = command.request.deadline_at;
                if write_frame(
                    &mut writer,
                    &HostFrame {
                        protocol_version: PROTOCOL_VERSION,
                        request_id,
                        command: HostCommand::Generate {
                            request: Box::new(command.request),
                        },
                    },
                )
                .is_err()
                {
                    let _ = response.send(Err("completion worker write failed".to_string()));
                    let _ = child.kill();
                    return;
                }
                active = Some((request_id, deadline_at, response));
            }
            Ok(ActorCommand::Cancel(request_id)) => {
                let _ = write_frame(
                    &mut writer,
                    &HostFrame {
                        protocol_version: PROTOCOL_VERSION,
                        request_id,
                        command: HostCommand::Cancel,
                    },
                );
                if active.as_ref().is_some_and(|item| item.0 == request_id) {
                    if let Some((_, _, response)) = active.take() {
                        let _ = response
                            .send(Err("completion decoder request was cancelled".to_string()));
                    }
                }
            }
            Ok(ActorCommand::Dispose) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = write_frame(
                    &mut writer,
                    &HostFrame {
                        protocol_version: PROTOCOL_VERSION,
                        request_id: 0,
                        command: HostCommand::Shutdown,
                    },
                );
                let _ = child.kill();
                return;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

pub(super) fn settle_worker_frame(frame: WorkerFrame, active: &mut Option<ActiveRequest>) {
    if frame.protocol_version != PROTOCOL_VERSION {
        return;
    }
    if active
        .as_ref()
        .is_none_or(|item| item.0 != frame.request_id)
    {
        return;
    }
    let Some((_, _, response)) = active.take() else {
        return;
    };
    match frame.event {
        WorkerEvent::Generated(envelope) => {
            let _ = response.send(Ok(envelope));
        }
        WorkerEvent::Error { message, .. } => {
            let _ = response.send(Err(message));
        }
        WorkerEvent::Ready(_) => {
            let _ = response.send(Err("unexpected worker ready frame".to_string()));
        }
    }
}

pub(super) fn settle_worker_failure(error: &str, active: &mut Option<ActiveRequest>) {
    if let Some((_, _, response)) = active.take() {
        let _ = response.send(Err(format!("completion worker crashed: {error}")));
    }
}
