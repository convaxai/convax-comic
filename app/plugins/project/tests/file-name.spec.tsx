import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProjectFileName, splitProjectFileName } from '../src/client/file-name.js'

describe('Project file middle ellipsis label', () => {
  it('keeps the final extension separate from the ellipsized prefix', () => {
    expect(splitProjectFileName('ep01_s01_casino_landing.png')).toEqual({
      prefix: 'ep01_s01_casino_landing',
      suffix: '.png',
    })
    expect(renderToStaticMarkup(<ProjectFileName name="ep01_s01_casino_landing.png" />))
      .toContain('<span class="cvxProjectFileNamePrefix">ep01_s01_casino_landing</span><span class="cvxProjectFileNameSuffix">.png</span>')
  })

  it('keeps both ends of long extensionless names', () => {
    expect(splitProjectFileName('VIDEO-GENERATION-PAUSED')).toEqual({
      prefix: 'VIDEO-GENERATION-PA',
      suffix: 'USED',
    })
    expect(splitProjectFileName('长文件名称没有扩展名字')).toEqual({
      prefix: '长文件名称没有',
      suffix: '扩展名字',
    })
  })

  it('does not split short extensionless names unnecessarily', () => {
    expect(splitProjectFileName('README')).toEqual({ prefix: 'README', suffix: '' })
  })
})
