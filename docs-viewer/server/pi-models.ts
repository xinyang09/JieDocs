import { execFile } from 'node:child_process'

export type PiModel = { provider: string; id: string }

export function parsePiModels(output: string): PiModel[] {
  const models: PiModel[] = []
  for (const line of output.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length !== 6 || !['yes', 'no'].includes(fields[4]) || !['yes', 'no'].includes(fields[5])) continue
    if (!models.some((model) => model.provider === fields[0] && model.id === fields[1])) models.push({ provider: fields[0], id: fields[1] })
  }
  return models
}

export function availablePiModels(): Promise<PiModel[]> {
  return new Promise((resolve, reject) => {
    execFile(process.env.PI_BIN || 'pi', ['--offline', '--list-models'], { timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const models = parsePiModels(`${stdout}\n${stderr}`)
      if (error && !models.length) reject(new Error('无法读取 Pi 模型列表，请检查 PI_BIN 和 Pi 的模型提供商配置。'))
      else resolve(models)
    })
  })
}
