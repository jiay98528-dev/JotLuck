import type { AppErrorCode, CommandErrorPayload, TranslationArgs } from '@/types';
import { translate } from '@/i18n';

const messageKeys: Record<AppErrorCode, string> = {
  not_found: 'errors.notFound',
  permission_denied: 'errors.permissionDenied',
  already_exists: 'errors.alreadyExists',
  invalid_path: 'errors.invalidPath',
  outside_notebook: 'errors.outsideNotebook',
  not_utf8: 'errors.notUtf8',
  file_too_large: 'errors.fileTooLarge',
  conflict: 'errors.conflict',
  disk_full: 'errors.diskFull',
  notebook_not_open: 'errors.notebookNotOpen',
  index_unavailable: 'errors.indexUnavailable',
  operation_failed: 'errors.operationFailed',
};

export class CommandError extends Error {
  readonly payload: CommandErrorPayload;
  readonly diagnostic?: string;

  constructor(payload: CommandErrorPayload, diagnostic?: string) {
    super(localizeCommandError(payload));
    this.name = 'CommandError';
    this.payload = payload;
    this.diagnostic = diagnostic;
  }
}

export class UserMessageError extends Error {
  readonly key: string;
  readonly args?: TranslationArgs;
  readonly diagnostic?: string;

  constructor(key: string, args?: TranslationArgs, diagnostic?: string) {
    // i18n-dynamic-key: UserMessageError keys are validated at each createUserMessageError call.
    super(translate(key, args));
    this.name = 'UserMessageError';
    this.key = key;
    this.args = args;
    this.diagnostic = diagnostic;
  }
}

export function localizeCommandError(payload: CommandErrorPayload): string {
  const key = messageKeys[payload.code] ?? messageKeys.operation_failed;
  // i18n-dynamic-key: every AppErrorCode maps to a literal catalog key in messageKeys.
  return translate(key, payload.args);
}

export function createCommandError(
  code: AppErrorCode,
  args?: TranslationArgs,
  diagnostic?: string,
): CommandError {
  return new CommandError({ code, args }, diagnostic);
}

export function createUserMessageError(
  key: string,
  args?: TranslationArgs,
  diagnostic?: string,
): UserMessageError {
  return new UserMessageError(key, args, diagnostic);
}

export function isCommandErrorPayload(value: unknown): value is CommandErrorPayload {
  if (!value || typeof value !== 'object') return false;
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(messageKeys, code);
}

function parsePayload(value: unknown): CommandErrorPayload | null {
  if (isCommandErrorPayload(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isCommandErrorPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function diagnosticFromUnknown(error: unknown): string | undefined {
  if (error instanceof CommandError || error instanceof UserMessageError) {
    return error.diagnostic;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error === null || error === undefined) return undefined;
  try {
    return JSON.stringify(error);
  } catch {
    return 'unserializable diagnostic';
  }
}

export function normalizeCommandError(error: unknown): CommandError | UserMessageError {
  if (error instanceof CommandError || error instanceof UserMessageError) return error;
  const payload = parsePayload(error);
  if (payload) return new CommandError(payload);
  return new CommandError({ code: 'operation_failed' }, diagnosticFromUnknown(error));
}

export function localizeUserError(
  error: unknown,
  fallbackKey = 'errors.operationFailed',
  fallbackArgs?: TranslationArgs,
): string {
  if (error instanceof CommandError || error instanceof UserMessageError) return error.message;
  const payload = parsePayload(error);
  if (payload) return localizeCommandError(payload);
  // i18n-dynamic-key: fallbackKey is validated at each localizeUserError call.
  return translate(fallbackKey, fallbackArgs);
}

export function getErrorDiagnostic(error: unknown): string | undefined {
  return diagnosticFromUnknown(error);
}
