import type { FileResult, TestResult } from '../runner/index.ts'

/** What XML 1.0 takes of `text`, with what it reads as markup escaped, for attributes and text alike. */
function escaped(text: string): string {
  return text
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10ffff}]/gu, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const seconds = (milliseconds: number) => (milliseconds / 1000).toFixed(3)

function testCase(path: string, { names, status, failures, duration }: TestResult): string {
  const attributes = `classname="${escaped(path)}" name="${escaped(names.join(' > '))}" time="${seconds(duration)}"`
  if (status === 'skipped') return `    <testcase ${attributes}><skipped/></testcase>\n`
  if (failures.length === 0) return `    <testcase ${attributes}/>\n`
  const shown = failures.map(({ message }) => {
    const first = message.split('\n', 1)[0] ?? ''
    return `      <failure message="${escaped(first)}">${escaped(message)}</failure>\n`
  })
  return `    <testcase ${attributes}>\n${shown.join('')}    </testcase>\n`
}

function testSuite({ path, tests, failure }: FileResult): string {
  const failed = tests.filter(({ status }) => status === 'failed').length
  const skipped = tests.filter(({ status }) => status === 'skipped').length
  const time = tests.reduce((sum, { duration }) => sum + duration, 0)
  // A file that did not load shows as a test of its own, so that tools see it fail.
  const loading =
    failure === undefined
      ? ''
      : `    <testcase classname="${escaped(path)}" name="(did not load)" time="0.000">\n      <failure message="${escaped(failure.message.split('\n', 1)[0] ?? '')}">${escaped(failure.message)}</failure>\n    </testcase>\n`
  const counts = `tests="${tests.length + (failure === undefined ? 0 : 1)}" failures="${failed + (failure === undefined ? 0 : 1)}" skipped="${skipped}"`
  const cases = tests.map((test) => testCase(path, test)).join('')
  return `  <testsuite name="${escaped(path)}" ${counts} time="${seconds(time)}">\n${loading}${cases}  </testsuite>\n`
}

/** What became of test files as a JUnit report, which tools such as test summaries of CI read. */
export function junitReport(files: readonly FileResult[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${files.map(testSuite).join('')}</testsuites>\n`
}
