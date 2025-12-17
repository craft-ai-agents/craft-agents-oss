import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface AskUserQuestionProps {
  questions: Question[];
  onSubmit: (answers: Record<string, string>) => void;
  onCancel?: () => void;
}

// Virtual "Other" option added to end of each question's options
const OTHER_OPTION: QuestionOption = {
  label: 'Other',
  description: 'Enter a custom response',
};

export const AskUserQuestion: React.FC<AskUserQuestionProps> = ({
  questions,
  onSubmit,
  onCancel,
}) => {
  // Current question index
  const [questionIndex, setQuestionIndex] = useState(0);
  // Currently highlighted option for each question (includes "Other" as last option)
  const [highlightedOptions, setHighlightedOptions] = useState<number[]>(
    questions.map(() => 0)
  );
  // Selected options for each question (for multiSelect, can have multiple)
  const [selectedOptions, setSelectedOptions] = useState<Set<number>[]>(
    questions.map(() => new Set<number>())
  );
  // For single select, track the chosen option
  const [singleSelections, setSingleSelections] = useState<(number | null)[]>(
    questions.map(() => null)
  );
  // Custom text for "Other" option per question
  const [otherTexts, setOtherTexts] = useState<string[]>(
    questions.map(() => '')
  );
  // Whether we're currently editing "Other" text
  const [editingOther, setEditingOther] = useState(false);

  const currentQuestion = questions[questionIndex];
  // Include "Other" as an extra option at the end
  const totalOptions = currentQuestion ? currentQuestion.options.length + 1 : 0;
  const otherIndex = currentQuestion ? currentQuestion.options.length : 0;
  const currentHighlight = highlightedOptions[questionIndex] ?? 0;
  const currentSelected = selectedOptions[questionIndex] ?? new Set<number>();
  const currentSingleSelection = singleSelections[questionIndex];
  const currentOtherText = otherTexts[questionIndex] ?? '';

  const handleSubmit = useCallback(() => {
    // Build answers object
    const answers: Record<string, string> = {};

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q) continue;

      const otherIdx = q.options.length; // "Other" is always last
      const otherText = otherTexts[i] ?? '';

      if (q.multiSelect) {
        const selected = selectedOptions[i] ?? new Set<number>();
        const labels = Array.from(selected)
          .map(idx => {
            if (idx === otherIdx) {
              return otherText || 'Other (no text)';
            }
            return q.options[idx]?.label;
          })
          .filter(Boolean)
          .join(', ');
        answers[q.question] = labels || 'None selected';
      } else {
        const idx = singleSelections[i];
        if (idx !== null && idx !== undefined) {
          if (idx === otherIdx) {
            answers[q.question] = otherText || 'Other (no text)';
          } else {
            answers[q.question] = q.options[idx]?.label ?? '';
          }
        } else {
          answers[q.question] = '';
        }
      }
    }

    onSubmit(answers);
  }, [questions, selectedOptions, singleSelections, otherTexts, onSubmit]);

  useInput((input, key) => {
    if (!currentQuestion) return;

    // If editing "Other" text, handle text input
    if (editingOther) {
      if (key.escape) {
        // Cancel editing, go back to selection
        setEditingOther(false);
        return;
      }
      if (key.return) {
        // Confirm text, go back to selection
        setEditingOther(false);
        return;
      }
      if (key.backspace || key.delete) {
        setOtherTexts(prev => {
          const newTexts = [...prev];
          newTexts[questionIndex] = (prev[questionIndex] ?? '').slice(0, -1);
          return newTexts;
        });
        return;
      }
      // Type character
      if (input && !key.ctrl && !key.meta) {
        setOtherTexts(prev => {
          const newTexts = [...prev];
          newTexts[questionIndex] = (prev[questionIndex] ?? '') + input;
          return newTexts;
        });
        return;
      }
      return;
    }

    // Navigation (includes "Other" option at the end)
    if (key.upArrow) {
      setHighlightedOptions(prev => {
        const newHighlights = [...prev];
        const current = newHighlights[questionIndex] ?? 0;
        newHighlights[questionIndex] = current > 0
          ? current - 1
          : totalOptions - 1;
        return newHighlights;
      });
    } else if (key.downArrow) {
      setHighlightedOptions(prev => {
        const newHighlights = [...prev];
        const current = newHighlights[questionIndex] ?? 0;
        newHighlights[questionIndex] = current < totalOptions - 1
          ? current + 1
          : 0;
        return newHighlights;
      });
    }
    // Tab to switch questions
    else if (key.tab && questions.length > 1) {
      if (key.shift) {
        setQuestionIndex(prev => prev > 0 ? prev - 1 : questions.length - 1);
      } else {
        setQuestionIndex(prev => prev < questions.length - 1 ? prev + 1 : 0);
      }
    }
    // Space to toggle/select
    else if (input === ' ') {
      // If on "Other", start editing
      if (currentHighlight === otherIndex) {
        if (currentQuestion.multiSelect) {
          // Toggle "Other" selection
          setSelectedOptions(prev => {
            const newSelected = [...prev];
            const current = new Set(newSelected[questionIndex]);
            if (current.has(currentHighlight)) {
              current.delete(currentHighlight);
            } else {
              current.add(currentHighlight);
            }
            newSelected[questionIndex] = current;
            return newSelected;
          });
        } else {
          setSingleSelections(prev => {
            const newSelections = [...prev];
            newSelections[questionIndex] = currentHighlight;
            return newSelections;
          });
        }
        setEditingOther(true);
        return;
      }

      if (currentQuestion.multiSelect) {
        // Toggle selection
        setSelectedOptions(prev => {
          const newSelected = [...prev];
          const current = new Set(newSelected[questionIndex]);
          if (current.has(currentHighlight)) {
            current.delete(currentHighlight);
          } else {
            current.add(currentHighlight);
          }
          newSelected[questionIndex] = current;
          return newSelected;
        });
      } else {
        // Single select
        setSingleSelections(prev => {
          const newSelections = [...prev];
          newSelections[questionIndex] = currentHighlight;
          return newSelections;
        });
      }
    }
    // Enter to confirm/next/submit
    else if (key.return) {
      // If on "Other" and not yet selected, select it and start editing
      if (currentHighlight === otherIndex) {
        if (!currentQuestion.multiSelect && currentSingleSelection !== otherIndex) {
          setSingleSelections(prev => {
            const newSelections = [...prev];
            newSelections[questionIndex] = currentHighlight;
            return newSelections;
          });
          setEditingOther(true);
          return;
        } else if (currentQuestion.multiSelect && !currentSelected.has(otherIndex)) {
          setSelectedOptions(prev => {
            const newSelected = [...prev];
            const current = new Set(newSelected[questionIndex]);
            current.add(currentHighlight);
            newSelected[questionIndex] = current;
            return newSelected;
          });
          setEditingOther(true);
          return;
        }
      }

      // For single select, select current if nothing selected
      if (!currentQuestion.multiSelect && currentSingleSelection === null) {
        setSingleSelections(prev => {
          const newSelections = [...prev];
          newSelections[questionIndex] = currentHighlight;
          return newSelections;
        });
      }

      // If more questions, go to next
      if (questionIndex < questions.length - 1) {
        setQuestionIndex(prev => prev + 1);
      } else {
        // Submit all answers
        handleSubmit();
      }
    }
    // Escape to cancel
    else if (key.escape) {
      onCancel?.();
    }
    // Number keys for quick select (includes "Other" as last number)
    else if (input >= '1' && input <= String(totalOptions)) {
      const idx = parseInt(input, 10) - 1;
      if (currentQuestion.multiSelect) {
        setSelectedOptions(prev => {
          const newSelected = [...prev];
          const current = new Set(newSelected[questionIndex]);
          if (current.has(idx)) {
            current.delete(idx);
          } else {
            current.add(idx);
          }
          newSelected[questionIndex] = current;
          return newSelected;
        });
      } else {
        setSingleSelections(prev => {
          const newSelections = [...prev];
          newSelections[questionIndex] = idx;
          return newSelections;
        });
      }
      setHighlightedOptions(prev => {
        const newHighlights = [...prev];
        newHighlights[questionIndex] = idx;
        return newHighlights;
      });
      // If selected "Other", start editing
      if (idx === otherIndex) {
        setEditingOther(true);
      }
    }
  });

  if (!currentQuestion) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} paddingY={1}>
      {/* Header chip */}
      <Box marginBottom={1}>
        <Text backgroundColor="cyan" color="black" bold>
          {' '}{currentQuestion.header}{' '}
        </Text>
        {questions.length > 1 && (
          <Text dimColor> ({questionIndex + 1}/{questions.length})</Text>
        )}
      </Box>

      {/* Question text */}
      <Box marginBottom={1}>
        <Text bold>{currentQuestion.question}</Text>
      </Box>

      {/* Options */}
      {currentQuestion.options.map((option, index) => {
        const isHighlighted = index === currentHighlight;
        const isSelected = currentQuestion.multiSelect
          ? currentSelected.has(index)
          : currentSingleSelection === index;

        // Checkbox/Radio visual
        const indicator = currentQuestion.multiSelect
          ? (isSelected ? '[✓]' : '[ ]')
          : (isSelected ? '(●)' : '( )');

        return (
          <Box key={index} flexDirection="column" marginLeft={1}>
            <Box>
              <Text
                color={isHighlighted ? 'cyan' : undefined}
                bold={isHighlighted}
                inverse={isHighlighted}
              >
                {' '}{indicator} {index + 1}. {option.label}{' '}
              </Text>
            </Box>
            {option.description && (
              <Box marginLeft={4}>
                <Text dimColor>{option.description}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      {/* "Other" option - always shown as last option */}
      {(() => {
        const isHighlighted = otherIndex === currentHighlight;
        const isSelected = currentQuestion.multiSelect
          ? currentSelected.has(otherIndex)
          : currentSingleSelection === otherIndex;

        const indicator = currentQuestion.multiSelect
          ? (isSelected ? '[✓]' : '[ ]')
          : (isSelected ? '(●)' : '( )');

        return (
          <Box key="other" flexDirection="column" marginLeft={1}>
            <Box>
              <Text
                color={isHighlighted ? 'cyan' : undefined}
                bold={isHighlighted}
                inverse={isHighlighted}
              >
                {' '}{indicator} {otherIndex + 1}. {OTHER_OPTION.label}{' '}
              </Text>
              {isSelected && currentOtherText && !editingOther && (
                <Text color="green">: {currentOtherText}</Text>
              )}
            </Box>
            {editingOther && isSelected ? (
              <Box marginLeft={4}>
                <Text color="yellow">&gt; </Text>
                <Text>{currentOtherText}</Text>
                <Text color="cyan">▋</Text>
              </Box>
            ) : (
              <Box marginLeft={4}>
                <Text dimColor>{OTHER_OPTION.description}</Text>
              </Box>
            )}
          </Box>
        );
      })()}

      {/* Help text */}
      <Box marginTop={1}>
        <Text dimColor>
          {editingOther ? (
            'Type your response | Enter confirm | Esc cancel'
          ) : (
            <>
              ↑↓ navigate | {currentQuestion.multiSelect ? 'Space toggle' : 'Space select'} | Enter {questionIndex < questions.length - 1 ? 'next' : 'submit'}
              {questions.length > 1 && ' | Tab switch'}
              {onCancel && ' | Esc cancel'}
            </>
          )}
        </Text>
      </Box>
    </Box>
  );
};
