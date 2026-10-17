export const taskBoardPriorityOrder = ['urgent', 'high', 'medium', 'normal', 'low', 'lowest'] as const

export type TaskBoardPriority = typeof taskBoardPriorityOrder[number]
export type TaskBoardGrouping = 'status' | 'priority'

export type TaskBoardTask = {
  completed: boolean
  priority: TaskBoardPriority
}

export type TaskBoardColumn<T> = {
  key: 'open' | 'done' | TaskBoardPriority
  tasks: T[]
}

export function groupTaskBoard<T extends TaskBoardTask>(tasks: T[], grouping: TaskBoardGrouping): TaskBoardColumn<T>[] {
  if (grouping === 'status') {
    return [
      { key: 'open', tasks: tasks.filter((task) => !task.completed) },
      { key: 'done', tasks: tasks.filter((task) => task.completed) },
    ]
  }
  return taskBoardPriorityOrder.map((priority) => ({
    key: priority,
    tasks: tasks.filter((task) => task.priority === priority),
  }))
}
