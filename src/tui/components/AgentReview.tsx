import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Concern } from '../../agents/types.ts';

export interface AgentReviewProps {
  agentName: string;
  concerns: Concern[];
  onSubmit: (answers: Record<string, string>) => void;
  onSkip: () => void;
}

export const AgentReview: React.FC<AgentReviewProps> = ({
  agentName,
  concerns,
  onSubmit,
  onSkip,
}) => {
  // Current concern index
  const [concernIndex, setConcernIndex] = useState(0);
  // Highlighted option for concerns with suggestedAnswers
  const [highlightedOptions, setHighlightedOptions] = useState<number[]>(
    concerns.map(() => 0)
  );
  // Selected answers for each concern
  // For options: index of selected option, for text: the text value
  const [answers, setAnswers] = useState<(number | string | null)[]>(
    concerns.map(() => null)
  );
  // For text input concerns, track the current input value
  const [textInputs, setTextInputs] = useState<string[]>(
    concerns.map(() => '')
  );
  // Track if we're in text input mode for current concern
  const currentConcern = concerns[concernIndex];
  const hasOptions = currentConcern?.suggestedAnswers && currentConcern.suggestedAnswers.length > 0;
  const currentHighlight = highlightedOptions[concernIndex] ?? 0;

  const getQuestion = (concern: Concern): string => {
    return concern.suggestedQuestion || concern.description;
  };

  const handleSubmit = useCallback(() => {
    const result: Record<string, string> = {};

    for (let i = 0; i < concerns.length; i++) {
      const concern = concerns[i];
      if (!concern) continue;

      const question = getQuestion(concern);
      const answer = answers[i];

      if (concern.suggestedAnswers && concern.suggestedAnswers.length > 0) {
        // Option-based answer
        if (typeof answer === 'number' && concern.suggestedAnswers[answer]) {
          result[question] = concern.suggestedAnswers[answer];
        } else {
          // Default to first option if not selected
          result[question] = concern.suggestedAnswers[0] || '';
        }
      } else {
        // Text-based answer
        result[question] = textInputs[i] || '';
      }
    }

    onSubmit(result);
  }, [concerns, answers, textInputs, onSubmit]);

  useInput((input, key) => {
    if (!currentConcern) return;

    // Escape to skip
    if (key.escape) {
      onSkip();
      return;
    }

    if (hasOptions) {
      // Option-based navigation
      const options = currentConcern.suggestedAnswers!;

      if (key.upArrow) {
        setHighlightedOptions(prev => {
          const newHighlights = [...prev];
          const current = newHighlights[concernIndex] ?? 0;
          newHighlights[concernIndex] = current > 0 ? current - 1 : options.length - 1;
          return newHighlights;
        });
      } else if (key.downArrow) {
        setHighlightedOptions(prev => {
          const newHighlights = [...prev];
          const current = newHighlights[concernIndex] ?? 0;
          newHighlights[concernIndex] = current < options.length - 1 ? current + 1 : 0;
          return newHighlights;
        });
      }
      // Space to select option
      else if (input === ' ') {
        setAnswers(prev => {
          const newAnswers = [...prev];
          newAnswers[concernIndex] = currentHighlight;
          return newAnswers;
        });
      }
      // Number keys for quick select
      else if (input >= '1' && input <= String(options.length)) {
        const idx = parseInt(input, 10) - 1;
        setAnswers(prev => {
          const newAnswers = [...prev];
          newAnswers[concernIndex] = idx;
          return newAnswers;
        });
        setHighlightedOptions(prev => {
          const newHighlights = [...prev];
          newHighlights[concernIndex] = idx;
          return newHighlights;
        });
      }
      // Enter to confirm and move to next or submit
      else if (key.return) {
        // Select current if nothing selected
        if (answers[concernIndex] === null) {
          setAnswers(prev => {
            const newAnswers = [...prev];
            newAnswers[concernIndex] = currentHighlight;
            return newAnswers;
          });
        }

        if (concernIndex < concerns.length - 1) {
          setConcernIndex(prev => prev + 1);
        } else {
          handleSubmit();
        }
      }
    } else {
      // Text input mode
      if (key.return) {
        if (concernIndex < concerns.length - 1) {
          setConcernIndex(prev => prev + 1);
        } else {
          handleSubmit();
        }
      } else if (key.backspace || key.delete) {
        setTextInputs(prev => {
          const newInputs = [...prev];
          newInputs[concernIndex] = (newInputs[concernIndex] || '').slice(0, -1);
          return newInputs;
        });
      } else if (input && !key.ctrl && !key.meta) {
        setTextInputs(prev => {
          const newInputs = [...prev];
          newInputs[concernIndex] = (newInputs[concernIndex] || '') + input;
          return newInputs;
        });
      }
    }

    // Tab to switch between concerns
    if (key.tab && concerns.length > 1) {
      if (key.shift) {
        setConcernIndex(prev => prev > 0 ? prev - 1 : concerns.length - 1);
      } else {
        setConcernIndex(prev => prev < concerns.length - 1 ? prev + 1 : 0);
      }
    }
  });

  if (!currentConcern) {
    return null;
  }

  const question = getQuestion(currentConcern);
  const currentAnswer = answers[concernIndex];

  // Get type color
  const typeColor = {
    confusing: 'yellow',
    conflicting: 'red',
    missing: 'blue',
    general: 'gray',
  }[currentConcern.type] || 'gray';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} paddingY={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text backgroundColor="magenta" color="white" bold>
          {' '}@{agentName} Setup{' '}
        </Text>
        {concerns.length > 1 && (
          <Text dimColor> ({concernIndex + 1}/{concerns.length})</Text>
        )}
      </Box>

      {/* Concern type badge */}
      <Box marginBottom={1}>
        <Text color={typeColor} bold>[{currentConcern.type}]</Text>
        {currentConcern.context && (
          <Text dimColor> {currentConcern.context}</Text>
        )}
      </Box>

      {/* Question */}
      <Box marginBottom={1}>
        <Text bold>{question}</Text>
      </Box>

      {/* Options or text input */}
      {hasOptions ? (
        // Selectable options
        currentConcern.suggestedAnswers!.map((option, index) => {
          const isHighlighted = index === currentHighlight;
          const isSelected = currentAnswer === index;
          const indicator = isSelected ? '(●)' : '( )';

          return (
            <Box key={index} marginLeft={1}>
              <Text
                color={isHighlighted ? 'cyan' : undefined}
                bold={isHighlighted}
                inverse={isHighlighted}
              >
                {' '}{indicator} {index + 1}. {option}{' '}
              </Text>
            </Box>
          );
        })
      ) : (
        // Text input
        <Box marginLeft={1} flexDirection="column">
          <Box>
            <Text dimColor>{'> '}</Text>
            <Text>{textInputs[concernIndex] || ''}</Text>
            <Text color="cyan" bold>▋</Text>
          </Box>
        </Box>
      )}

      {/* Help text */}
      <Box marginTop={1}>
        <Text dimColor>
          {hasOptions
            ? `↑↓ navigate | Space select | Enter ${concernIndex < concerns.length - 1 ? 'next' : 'submit'}`
            : `Type answer | Enter ${concernIndex < concerns.length - 1 ? 'next' : 'submit'}`}
          {concerns.length > 1 && ' | Tab switch'}
          {' | Esc skip'}
        </Text>
      </Box>
    </Box>
  );
};
