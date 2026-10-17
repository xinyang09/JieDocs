import type { AIAction, AIBlock } from './ai-contract.ts'

export type BlockActionId = 'ask' | 'rewrite' | 'summarize' | 'translate'

export function blockAIAction(id: BlockActionId, block: AIBlock, instruction = '', language = '英文'): AIAction {
  const text = instruction.trim()
  switch (id) {
    case 'rewrite': return { type: 'rewrite', target: 'selection', instruction: text || `改写块「${block.id}」的内容，保留原意。` }
    case 'summarize': return { type: 'summarize', instruction: text || `总结块「${block.id}」的内容。` }
    case 'translate': return { type: 'translate', language, target: 'selection', instruction: text || `将块「${block.id}」翻译成${language}。` }
    case 'ask': return { type: 'answer', instruction: text || `解释块「${block.id}」的内容。` }
  }
}

export function blockSelection(block: AIBlock) {
  return { text: block.text, start: block.start, end: block.end, blockId: block.id }
}
