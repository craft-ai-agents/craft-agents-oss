import React from 'react';
import { Box, Text } from 'ink';

/**
 * Todo item structure (matches SDK's TodoWrite schema)
 */
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

export interface TodoListProps {
  todos: TodoItem[];
}

/**
 * Status icons for todo items
 */
const STATUS_ICONS: Record<TodoItem['status'], string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
};

/**
 * Status colors for todo items
 */
const STATUS_COLORS: Record<TodoItem['status'], string> = {
  pending: 'gray',
  in_progress: 'yellow',
  completed: 'green',
};

/**
 * TodoList component - displays the current todo list from Claude's TodoWrite tool
 */
export const TodoList: React.FC<TodoListProps> = ({ todos }) => {
  if (todos.length === 0) {
    return null;
  }

  // Find the currently active task (in_progress)
  const activeTask = todos.find(t => t.status === 'in_progress');

  // Count completed vs total
  const completedCount = todos.filter(t => t.status === 'completed').length;
  const totalCount = todos.length;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={0}>
        <Text bold color="cyan">Tasks </Text>
        <Text dimColor>({completedCount}/{totalCount})</Text>
        {activeTask && (
          <Text color="yellow"> • {activeTask.activeForm}</Text>
        )}
      </Box>
      <Box flexDirection="column" paddingLeft={1}>
        {todos.map((todo, index) => (
          <Box key={index}>
            <Text color={STATUS_COLORS[todo.status]}>
              {STATUS_ICONS[todo.status]}
            </Text>
            <Text
              color={todo.status === 'completed' ? 'gray' : undefined}
              strikethrough={todo.status === 'completed'}
            >
              {' '}{todo.content}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
