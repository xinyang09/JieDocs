import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { UniverInstanceType } from '@univerjs/core'
import {
  ExchangeFormat,
  exportToBuffer,
  importBuffer,
} from '@univerjs-pro/exchange-node'

const [, , command, ...args] = process.argv

const typeByName = {
  sheet: UniverInstanceType.UNIVER_SHEET,
  doc: UniverInstanceType.UNIVER_DOC,
  slide: UniverInstanceType.UNIVER_SLIDE,
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function requireType(value) {
  const type = typeByName[value]
  if (!type) fail(`Unsupported Univer type: ${value}`)
  return type
}

function requireFormat(value) {
  const format = ExchangeFormat[value?.toUpperCase()]
  if (!format) fail(`Unsupported exchange format: ${value}`)
  return format
}

if (command === 'import') {
  const [inputPath, typeName, formatName, fileName] = args
  if (!inputPath || !typeName || !formatName || !fileName) fail('Usage: import <path> <type> <format> <fileName>')
  const input = await readFile(inputPath)
  const result = await importBuffer(input, {
    type: requireType(typeName),
    format: requireFormat(formatName),
    fileName,
  })
  process.stdout.write(JSON.stringify({ unitData: result }))
} else if (command === 'export') {
  const [inputPath, outputPath, typeName, formatName] = args
  if (!inputPath || !outputPath || !typeName || !formatName) fail('Usage: export <inputJson> <outputPath> <type> <format>')
  const input = JSON.parse(await readFile(inputPath, 'utf8'))
  const output = await exportToBuffer(input, {
    type: requireType(typeName),
    format: requireFormat(formatName),
  })
  await writeFile(outputPath, output)
} else {
  fail('Usage: import|export ...')
}
