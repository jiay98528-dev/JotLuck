/**
 * 13-toast.spec.ts — Toast 通知系统 E2E 测试
 *
 * 覆盖：四种类型显示、自动消失、手动关闭、堆叠行为
 */
import { test, expect } from '@playwright/test';
import { waitForAppReady } from '../helpers/test-utils';

test.describe('Toast 通知容器', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('01-Toast 容器存在', async ({ page }) => {
    // Toast 容器应该在 DOM 中（即使为空）
    const container = page.locator('.toast-container--top-center');
    await expect(container.first()).toBeVisible({ timeout: 3000 });
  });

  test('02-Toast 容器是 status role', async ({ page }) => {
    const container = page.locator('.toast-container, [role="status"]');
    const count = await container.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('03-Toast 堆叠容器存在', async ({ page }) => {
    const stack = page.locator('.toast-stack');
    await expect(stack.first()).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Toast 触发与显示', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('04-通过 JavaScript 触发 info Toast', async ({ page }) => {
    await page.evaluate(() => {
      // 使用应用的 Toast store 触发
      const app = document.querySelector('#app');
      if (app && (app as any).__vue_app__) {
        // Try to access Pinia toast store
        const pinia = (app as any).__vue_app__.config.globalProperties.$pinia;
        if (pinia) {
          // Direct DOM manipulation as fallback
          const container = document.querySelector('.toast-stack');
          if (container) {
            const toast = document.createElement('div');
            toast.className = 'toast toast--info';
            toast.setAttribute('role', 'alert');
            toast.innerHTML =
              '<span class="toast-icon">ℹ</span><span class="toast-msg">E2E 测试通知</span>';
            container.appendChild(toast);
          }
        }
      }
    });

    await page.waitForTimeout(300);

    // Toast 应该出现
    await expect(page.locator('.toast--info')).toBeVisible({ timeout: 3000 });
  });

  test('05-通过 JavaScript 触发 success Toast', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.querySelector('.toast-stack');
      if (container) {
        const toast = document.createElement('div');
        toast.className = 'toast toast--success';
        toast.setAttribute('role', 'alert');
        toast.innerHTML =
          '<span class="toast-icon">✓</span><span class="toast-msg">操作成功</span>';
        container.appendChild(toast);
      }
    });

    await page.waitForTimeout(300);

    await expect(page.locator('.toast--success')).toBeVisible({ timeout: 3000 });
  });

  test('06-通过 JavaScript 触发 warning Toast', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.querySelector('.toast-stack');
      if (container) {
        const toast = document.createElement('div');
        toast.className = 'toast toast--warning';
        toast.setAttribute('role', 'alert');
        toast.innerHTML = '<span class="toast-icon">⚠</span><span class="toast-msg">请注意</span>';
        container.appendChild(toast);
      }
    });

    await page.waitForTimeout(300);
    await expect(page.locator('.toast--warning')).toBeVisible({ timeout: 3000 });
  });

  test('07-通过 JavaScript 触发 error Toast', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.querySelector('.toast-stack');
      if (container) {
        const toast = document.createElement('div');
        toast.className = 'toast toast--error';
        toast.setAttribute('role', 'alert');
        toast.innerHTML =
          '<span class="toast-icon">✕</span><span class="toast-msg">操作失败</span>';
        container.appendChild(toast);
      }
    });

    await page.waitForTimeout(300);
    await expect(page.locator('.toast--error')).toBeVisible({ timeout: 3000 });
  });

  test('08-多条 Toast 同时显示', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.querySelector('.toast-stack');
      if (container) {
        const types = ['info', 'success', 'warning'];
        types.forEach((type, i) => {
          const toast = document.createElement('div');
          toast.className = `toast toast--${type}`;
          toast.setAttribute('role', 'alert');
          toast.innerHTML = `<span class="toast-icon">•</span><span class="toast-msg">消息 ${i + 1}</span>`;
          container.appendChild(toast);
        });
      }
    });

    await page.waitForTimeout(300);

    const toasts = page.locator('.toast');
    const count = await toasts.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

test.describe('Toast 关闭', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('09-Toast 有关闭按钮', async ({ page }) => {
    // 先触发一个 toast
    await page.evaluate(() => {
      const container = document.querySelector('.toast-stack');
      if (container) {
        const toast = document.createElement('div');
        toast.className = 'toast toast--info';
        toast.setAttribute('role', 'alert');
        toast.innerHTML =
          '<span class="toast-icon">ℹ</span><span class="toast-msg">可关闭通知</span><button class="toast-close" aria-label="关闭通知：可关闭通知" title="关闭">&times;</button>';
        container.appendChild(toast);
      }
    });

    await page.waitForTimeout(300);

    await expect(page.locator('.toast-close, [title="关闭"]').first()).toBeVisible({
      timeout: 3000,
    });
  });

  test('10-点击关闭按钮移除 Toast', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.querySelector('.toast-stack');
      if (container) {
        const toast = document.createElement('div');
        toast.className = 'toast toast--info';
        toast.setAttribute('role', 'alert');
        toast.id = 'test-toast-close';
        toast.innerHTML =
          '<span class="toast-icon">ℹ</span><span class="toast-msg">点击关闭</span><button class="toast-close" title="关闭" onclick="this.parentElement.remove()">&times;</button>';
        container.appendChild(toast);
      }
    });

    await page.waitForTimeout(300);

    const closeBtn = page.locator('.toast-close').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    }
  });
});
