import assert from 'node:assert/strict'
import test from 'node:test'
import { groupTaskBoard, taskBoardPriorityOrder, type TaskBoardTask } from '../src/task-board.ts'

const tasks: TaskBoardTask[] = [
  { completed: false, priority: 'urgent' },
  { completed: true, priority: 'urgent' },
  { completed: false, priority: 'low' },
]

test('groups tasks into status columns without changing the source list', () => {
  const columns = groupTaskBoard(tasks, 'status')
  assert.deepEqual(columns.map((column) => [column.key, column.tasks.length]), [['open', 2], ['done', 1]])
  assert.equal(tasks.length, 3)
})

test('groups tasks into every priority column in display order', () => {
  const columns = groupTaskBoard(tasks, 'priority')
  assert.deepEqual(columns.map((column) => column.key), [...taskBoardPriorityOrder])
  assert.deepEqual(columns.map((column) => column.tasks.length), [2, 0, 0, 0, 1, 0])
})
