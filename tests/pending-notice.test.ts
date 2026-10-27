import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import PendingMutationNotice from '../src/components/PendingMutationNotice'
import type { MutationRequest } from '../shared/contracts'

const request: MutationRequest = {operation:'register',requestId:'84a3c6c0-0562-4b9f-bc9f-fcc3bd8bb88f',rosterHash:'f'.repeat(64),ids:['demo-student-001']}
const render = (pending: MutationRequest | null, inFlight: boolean) => renderToStaticMarkup(createElement(PendingMutationNotice,{pending,inFlight,recover:async()=>{}}))

it('正常提交和恢复请求执行中只显示进度，不显示警告或恢复按钮',()=>{
  const html=render(request,true)
  expect(html).toContain('role="status"')
  expect(html).toContain('正在登记')
  expect(html).not.toContain('role="alert"')
  expect(html).not.toContain('<button')
})
it('异常后或刷新恢复的待确认请求才显示警告和原请求恢复按钮',()=>{
  const html=render(request,false)
  expect(html).toContain('role="alert"')
  expect(html).toContain('暂勿发牌')
  expect(html).toContain('恢复原请求结果')
  expect(html).toContain('<button')
})
it('成功清除原请求后不再显示进度或警告',()=>{
  expect(render(null,false)).toBe('')
  expect(render(null,true)).toBe('')
})
it('纠正请求也区分进行中与结果未知',()=>{
  const correction: MutationRequest={operation:'correct',requestId:request.requestId,rosterHash:request.rosterHash,id:'demo-student-001',target:null,expectedVersion:0}
  expect(render(correction,true)).toContain('正在纠正')
  expect(render(correction,true)).not.toContain('role="alert"')
  expect(render(correction,false)).toContain('纠正结果暂未确认')
})
