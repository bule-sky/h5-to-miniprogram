const path = require('path')

const request = require('request-promise-native')

const _ = require('../utils')
const config = require('../config')
const adjust = require('./adjust')

module.exports = {
  /**
   * 生成脚本
   */
  async generate(options) {
    const entry = options.entry
    const output = options.output
    const commonOutput = options.commonOutput
    const jsList = options.jsList
    const body = options.body
    const entryKey = options.entryKey
    const needCompress = !!options.compress.jsInH5
    const proxy = options.proxy
    const dirPath = path.dirname(entry)

    // 依赖
    const deps = [
      'const ast = require(\'./ast\');', // 页面的 ast
      'const config = require(\'../../config\');', // 配置
      'const initGlobalVar = require(\'../../common/js/init-global-var\');', // 全局变量初始化
      'const initDocumentVar = require(\'../../common/js/init-document-var\');', // document 字段初始化
      'const load = require(\'../../adapter/index\');\n',
      ['Window', 'Document', 'cache', 'tool', 'Event'].map(item => `const ${item} = load('${item}');`).join('\n')
    ].join('\n')

    let content = [
      deps,
      `const pageKey = '${entryKey}';\nconst run = function(window, document) {`,
      `${config.indent}const global = null;`
    ]

    // 遍历页面中的静态 js
    for (const js of jsList) {
      if (js.type === 'inner') {
        const adjustContent = await adjust(js.content, needCompress)

        content.push(`${config.indent}/* inner script */\n${adjustContent}`)
      } else if (js.type === 'outer') {
        let jsPath = js.src
        let srcContent

        if (_.isRelative(jsPath)) {
          // 相对路径
          jsPath = path.join(dirPath, jsPath)
          srcContent = await _.readFile(jsPath)
        } else {
          // 其他
          const isFileExists = await _.checkFileExists(jsPath)

          if (isFileExists) {
            // 绝对路径
            srcContent = await _.readFile(jsPath)
          } else {
            // 网络 url
            srcContent = await request.get({url: jsPath, proxy})
          }
        }

        if (srcContent) {
          // 写入 common 目录
          const extname = path.extname(jsPath)
          const filename = `${path.basename(jsPath, extname)}-${_.hash(srcContent)}.js`
          const adjustContent = await adjust(srcContent, needCompress)

          await _.writeFile(path.join(commonOutput, filename), [
            'module.exports=function(window,document){',
            'var module=undefined;',
            'var global=window;',
            `(function(){${adjustContent}}).call(window)`, // 保证 this 指向 window
            '};',
          ].join(''))
          content.push(`${config.indent}/* outer script: ${js.src} */\n${config.indent}require('../../common/js/${filename}')(window, document);`)
        }
      }
    }

    content.push('};')

    // 插入 Page 声明
    const pageTmpl = await _.readFile(path.join(__dirname, './page.js.tmpl'))
    content.push(pageTmpl)

    content = content.join('\n\n')

    // 输出页面 js
    await _.writeFile(output, content)

    // 输出页面 ast
    const astContent = needCompress ? JSON.stringify(body) : JSON.stringify(body, null, config.indent)
    await _.writeFile(path.join(path.dirname(output), './ast.js'), `module.exports = ${astContent};`)
  }
}
