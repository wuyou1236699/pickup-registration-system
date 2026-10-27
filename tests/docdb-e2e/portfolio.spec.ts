import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

test('虚构数据作品截图：登记、成功结果和名单管理', async ({ page }) => {
  await mkdir('docs/images', { recursive: true })
  await page.goto('/')
  for (const name of ['示例学员051', '示例学员052']) {
    await page.getByRole('combobox').fill(name)
    await page.getByRole('combobox').press('Enter')
  }
  await expect(page.locator('.selected-person')).toHaveCount(2)
  await page.screenshot({ path: 'docs/images/registration.png', fullPage: true })
  await page.getByRole('button', { name: '确认登记' }).click()
  await expect(page.locator('.big-ticket')).toBeVisible()
  await page.screenshot({ path: 'docs/images/success.png', fullPage: true })
  await page.getByRole('link', { name: '名单管理', exact: true }).click()
  await expect(page.locator('.table-summary')).toContainText('152')
  await page.screenshot({ path: 'docs/images/management.png', fullPage: true })
})
