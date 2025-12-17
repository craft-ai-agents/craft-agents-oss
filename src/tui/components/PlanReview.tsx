import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Plan, PlanStep } from '../../agents/plan-types.ts';
import { savePlanToFile } from '../../config/storage.ts';

/**
 * Step action in the interactive plan review (like git interactive rebase)
 * - accept: Include this step in the final plan (●)
 * - delete: Remove this step from the final plan (⊗)
 * - refine: Edit/update this step in place (R)
 */
type StepAction = 'accept' | 'delete' | 'refine';

/**
 * Bottom action buttons
 */
type BottomAction = 'accept' | 'save' | 'cancel';

/** Static bottom actions - defined outside component to avoid recreation */
const BOTTOM_ACTIONS: { key: BottomAction; label: string; shortcut: string }[] = [
  { key: 'accept', label: 'Accept', shortcut: 'A' },
  { key: 'save', label: 'Save Plan', shortcut: 'S' },
  { key: 'cancel', label: 'Cancel', shortcut: 'C' },
];

export interface PlanReviewProps {
  plan: Plan;
  sessionId: string;
  questions?: string[];
  /** Accept: Save plan and execute */
  onApprove: (modifiedPlan: Plan, savedPath: string) => void;
  /** Refine: Request changes with feedback */
  onRefine: (feedback: string) => void;
  /** Save Plan: Save plan but cancel execution */
  onSaveOnly: (modifiedPlan: Plan, savedPath: string) => void;
  /** Cancel: Just cancel, don't save */
  onCancel: () => void;
}

export const PlanReview: React.FC<PlanReviewProps> = ({
  plan,
  sessionId,
  questions = [],
  onApprove,
  onRefine,
  onSaveOnly,
  onCancel,
}) => {
  // Currently focused step index (-1 means we're in bottom action bar)
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Whether we're in the bottom action bar
  const [inActionBar, setInActionBar] = useState(false);

  // Currently selected bottom action
  const [selectedAction, setSelectedAction] = useState<BottomAction>('accept');

  // Action for each step: accept, delete, or refine
  const [stepActions, setStepActions] = useState<Map<string, StepAction>>(() => {
    const initial = new Map<string, StepAction>();
    for (const step of plan.steps) {
      initial.set(step.id, 'accept');
    }
    return initial;
  });

  // Refinement text for steps marked as 'refine'
  const [stepRefinements, setStepRefinements] = useState<Map<string, string>>(new Map());

  // Currently editing step (inline text input)
  const [editingStepId, setEditingStepId] = useState<string | null>(null);

  // Current text in the inline editor
  const [editText, setEditText] = useState('');

  // Scroll offset for long plans
  const [scrollOffset, setScrollOffset] = useState(0);

  const maxVisibleSteps = 10;

  // Get the current step
  const currentStep = plan.steps[focusedIndex];

  // Current index in bottom actions (memoized to avoid duplicate findIndex calls)
  const currentActionIndex = useMemo(
    () => BOTTOM_ACTIONS.findIndex(a => a.key === selectedAction),
    [selectedAction]
  );

  // Cycle through step actions: accept -> delete -> refine -> accept
  const cycleStepAction = useCallback((stepId: string) => {
    setStepActions(prev => {
      const newActions = new Map(prev);
      const current = newActions.get(stepId) || 'accept';
      const next: StepAction =
        current === 'accept' ? 'delete' :
        current === 'delete' ? 'refine' : 'accept';
      newActions.set(stepId, next);

      // If changing away from refine, clear refinement text
      if (current === 'refine' && next !== 'refine') {
        setStepRefinements(prevRefinements => {
          const newRefinements = new Map(prevRefinements);
          newRefinements.delete(stepId);
          return newRefinements;
        });
      }

      return newActions;
    });
  }, []);

  // Set specific action for a step
  const setStepAction = useCallback((stepId: string, action: StepAction) => {
    setStepActions(prev => {
      const newActions = new Map(prev);
      const current = newActions.get(stepId) || 'accept';
      newActions.set(stepId, action);

      // If changing away from refine, clear refinement text
      if (current === 'refine' && action !== 'refine') {
        setStepRefinements(prevRefinements => {
          const newRefinements = new Map(prevRefinements);
          newRefinements.delete(stepId);
          return newRefinements;
        });
      }

      return newActions;
    });
  }, []);

  // Start editing a step's refinement
  const startEditing = useCallback((stepId: string) => {
    const existingRefinement = stepRefinements.get(stepId) || '';
    setEditText(existingRefinement);
    setEditingStepId(stepId);
  }, [stepRefinements]);

  // Save editing
  const saveEditing = useCallback(() => {
    if (editingStepId && editText.trim()) {
      setStepRefinements(prev => {
        const newRefinements = new Map(prev);
        newRefinements.set(editingStepId, editText.trim());
        return newRefinements;
      });
    }
    setEditingStepId(null);
    setEditText('');
  }, [editingStepId, editText]);

  // Cancel editing
  const cancelEditing = useCallback(() => {
    setEditingStepId(null);
    setEditText('');
  }, []);

  // Build the final plan with modifications applied
  const buildModifiedPlan = useCallback((): Plan => {
    const modifiedSteps: PlanStep[] = [];

    for (const step of plan.steps) {
      const action = stepActions.get(step.id) || 'accept';

      if (action === 'delete') {
        // Skip deleted steps
        continue;
      }

      if (action === 'refine') {
        const refinement = stepRefinements.get(step.id);
        if (refinement) {
          // Add refinement as additional details
          modifiedSteps.push({
            ...step,
            description: `${step.description} [REFINE: ${refinement}]`,
          });
        } else {
          modifiedSteps.push(step);
        }
      } else {
        modifiedSteps.push(step);
      }
    }

    return {
      ...plan,
      steps: modifiedSteps,
      updatedAt: Date.now(),
    };
  }, [plan, stepActions, stepRefinements]);

  // Check for missing refinements and focus on first one
  const checkMissingRefinements = useCallback((): boolean => {
    const refinedSteps = Array.from(stepActions.entries())
      .filter(([, action]) => action === 'refine');

    const missingRefinements = refinedSteps.filter(
      ([stepId]) => !stepRefinements.get(stepId)?.trim()
    );

    if (missingRefinements.length > 0) {
      const stepId = missingRefinements[0]![0];
      const index = plan.steps.findIndex(s => s.id === stepId);
      if (index >= 0) {
        setInActionBar(false);
        setFocusedIndex(index);
        startEditing(stepId);
      }
      return true;
    }
    return false;
  }, [plan, stepActions, stepRefinements, startEditing]);

  // Check if there are any modifications that need refinement feedback
  const hasModifications = useCallback((): boolean => {
    for (const step of plan.steps) {
      const action = stepActions.get(step.id);
      if (action === 'delete' || action === 'refine') {
        return true;
      }
    }
    return false;
  }, [plan, stepActions]);

  // Handle Accept action (save + execute)
  const handleAccept = useCallback(() => {
    if (checkMissingRefinements()) return;

    // If there are modifications, send as refinement feedback
    if (hasModifications()) {
      const refinementFeedback: string[] = [];
      for (const step of plan.steps) {
        const action = stepActions.get(step.id);
        if (action === 'delete') {
          refinementFeedback.push(`- Remove step: "${step.description}"`);
        } else if (action === 'refine') {
          const refinement = stepRefinements.get(step.id);
          if (refinement) {
            refinementFeedback.push(`- Modify step "${step.description}": ${refinement}`);
          }
        }
      }
      onRefine(refinementFeedback.join('\n'));
    } else {
      // No changes - save plan to file and approve
      const modifiedPlan = buildModifiedPlan();
      const savedPath = savePlanToFile(sessionId, modifiedPlan);
      onApprove(modifiedPlan, savedPath);
    }
  }, [plan, stepActions, stepRefinements, checkMissingRefinements, hasModifications, onApprove, onRefine, buildModifiedPlan, sessionId]);

  // Handle Save Plan action (save + cancel, don't execute)
  const handleSaveOnly = useCallback(() => {
    if (checkMissingRefinements()) return;

    const modifiedPlan = buildModifiedPlan();
    const savedPath = savePlanToFile(sessionId, modifiedPlan);
    onSaveOnly(modifiedPlan, savedPath);
  }, [checkMissingRefinements, buildModifiedPlan, onSaveOnly, sessionId]);

  // Execute the selected bottom action
  const executeBottomAction = useCallback(() => {
    switch (selectedAction) {
      case 'accept':
        handleAccept();
        break;
      case 'save':
        handleSaveOnly();
        break;
      case 'cancel':
        onCancel();
        break;
    }
  }, [selectedAction, handleAccept, handleSaveOnly, onCancel]);

  // Handle input
  useInput((input, key) => {
    // Inline editing mode
    if (editingStepId) {
      if (key.escape) {
        cancelEditing();
        return;
      }
      if (key.return) {
        saveEditing();
        return;
      }
      if (key.backspace || key.delete) {
        setEditText(prev => prev.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setEditText(prev => prev + input);
      }
      return;
    }

    // Escape to cancel
    if (key.escape) {
      onCancel();
      return;
    }

    // Tab to toggle between steps and action bar
    if (key.tab) {
      setInActionBar(prev => !prev);
      return;
    }

    if (inActionBar) {
      // In action bar - left/right to select action
      if (key.leftArrow) {
        const newIndex = currentActionIndex > 0 ? currentActionIndex - 1 : BOTTOM_ACTIONS.length - 1;
        setSelectedAction(BOTTOM_ACTIONS[newIndex]!.key);
        return;
      }
      if (key.rightArrow) {
        const newIndex = currentActionIndex < BOTTOM_ACTIONS.length - 1 ? currentActionIndex + 1 : 0;
        setSelectedAction(BOTTOM_ACTIONS[newIndex]!.key);
        return;
      }
      // Up to go back to steps
      if (key.upArrow) {
        setInActionBar(false);
        return;
      }
      // Enter to execute selected action
      if (key.return) {
        executeBottomAction();
        return;
      }
    } else {
      // In steps list - up/down to navigate
      if (key.upArrow) {
        setFocusedIndex(prev => {
          const newIndex = Math.max(0, prev - 1);
          if (newIndex < scrollOffset) {
            setScrollOffset(newIndex);
          }
          return newIndex;
        });
        return;
      }
      if (key.downArrow) {
        if (focusedIndex >= plan.steps.length - 1) {
          // At bottom of steps, move to action bar
          setInActionBar(true);
        } else {
          setFocusedIndex(prev => {
            const newIndex = Math.min(plan.steps.length - 1, prev + 1);
            if (newIndex >= scrollOffset + maxVisibleSteps) {
              setScrollOffset(newIndex - maxVisibleSteps + 1);
            }
            return newIndex;
          });
        }
        return;
      }

      // Space to cycle action
      if (input === ' ' && currentStep) {
        cycleStepAction(currentStep.id);
        return;
      }

      // Step action quick keys (only when in steps)
      if (currentStep) {
        const lowerInput = input.toLowerCase();
        if (lowerInput === 'd' || lowerInput === 'x') {
          setStepAction(currentStep.id, 'delete');
          return;
        }
        if (lowerInput === 'r') {
          setStepAction(currentStep.id, 'refine');
          return;
        }
        if (lowerInput === 'e') {
          const action = stepActions.get(currentStep.id);
          if (action === 'refine') {
            startEditing(currentStep.id);
          } else {
            setStepAction(currentStep.id, 'refine');
            startEditing(currentStep.id);
          }
          return;
        }
      }
    }

    // Global quick keys (work anywhere) - these trigger the bottom action bar actions
    if (input.toLowerCase() === 'a') {
      handleAccept();
      return;
    }
    if (input.toLowerCase() === 's') {
      handleSaveOnly();
      return;
    }
    if (input.toLowerCase() === 'c') {
      onCancel();
      return;
    }
  });

  // Get action icon
  const getActionIcon = (action: StepAction): string => {
    switch (action) {
      case 'accept':
        return '●';
      case 'delete':
        return '⊗';
      case 'refine':
        return '(R)';
    }
  };

  // Get action color
  const getActionColor = (action: StepAction): string => {
    switch (action) {
      case 'accept':
        return 'green';
      case 'delete':
        return 'red';
      case 'refine':
        return 'yellow';
    }
  };

  // Summary of changes
  const summary = useMemo(() => {
    let accepted = 0;
    let deleted = 0;
    let refined = 0;
    for (const action of stepActions.values()) {
      if (action === 'accept') accepted++;
      else if (action === 'delete') deleted++;
      else if (action === 'refine') refined++;
    }
    return { accepted, deleted, refined };
  }, [stepActions]);

  // Visible steps with scroll
  const visibleSteps = plan.steps.slice(scrollOffset, scrollOffset + maxVisibleSteps);
  const hasMoreAbove = scrollOffset > 0;
  const hasMoreBelow = scrollOffset + maxVisibleSteps < plan.steps.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1} paddingY={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text backgroundColor="blue" color="white" bold>
          {' '}Plan Review: {plan.title}{' '}
        </Text>
      </Box>

      {/* Instructions */}
      <Box marginBottom={1}>
        <Text dimColor>Interactive plan review - select action for each step:</Text>
      </Box>

      {/* Legend */}
      <Box marginBottom={1} gap={2}>
        <Text color="green">● Accept</Text>
        <Text color="red">⊗ Delete</Text>
        <Text color="yellow">(R) Refine</Text>
      </Box>

      {/* Steps list */}
      <Box flexDirection="column" marginBottom={1}>
        {hasMoreAbove && (
          <Text dimColor>  ↑ {scrollOffset} more above</Text>
        )}

        {visibleSteps.map((step, index) => {
          const actualIndex = scrollOffset + index;
          const isFocused = !inActionBar && actualIndex === focusedIndex;
          const action = stepActions.get(step.id) || 'accept';
          const refinementText = stepRefinements.get(step.id);
          const isEditing = editingStepId === step.id;

          return (
            <Box key={step.id} flexDirection="column">
              <Box>
                <Text color={isFocused ? 'cyan' : undefined}>
                  {isFocused ? '>' : ' '}
                </Text>
                <Text color={getActionColor(action)} bold={isFocused}>
                  {' '}{getActionIcon(action)}{' '}
                </Text>
                <Text
                  color={action === 'delete' ? 'gray' : isFocused ? 'cyan' : undefined}
                  strikethrough={action === 'delete'}
                  bold={isFocused}
                >
                  {actualIndex + 1}. {step.description}
                </Text>
              </Box>

              {/* Show refinement text or editor */}
              {action === 'refine' && (
                <Box marginLeft={4}>
                  {isEditing ? (
                    <Box>
                      <Text color="yellow">  Refinement: </Text>
                      <Text>{editText}</Text>
                      <Text color="cyan" bold>|</Text>
                    </Box>
                  ) : refinementText ? (
                    <Text color="yellow" dimColor>  → {refinementText}</Text>
                  ) : (
                    <Text color="red" dimColor>  → (press E to add refinement)</Text>
                  )}
                </Box>
              )}
            </Box>
          );
        })}

        {hasMoreBelow && (
          <Text dimColor>  ↓ {plan.steps.length - scrollOffset - maxVisibleSteps} more below</Text>
        )}

        {plan.steps.length === 0 && (
          <Text dimColor>  (No steps in plan)</Text>
        )}
      </Box>

      {/* Questions from Claude (if any) */}
      {questions.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="yellow">Questions:</Text>
          {questions.map((q, index) => (
            <Box key={index} marginLeft={1}>
              <Text color="yellow">? {q}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Summary */}
      <Box marginBottom={1} gap={2}>
        <Text dimColor>Summary:</Text>
        <Text color="green">{summary.accepted} accept</Text>
        {summary.deleted > 0 && <Text color="red">{summary.deleted} delete</Text>}
        {summary.refined > 0 && <Text color="yellow">{summary.refined} refine</Text>}
      </Box>

      {/* Bottom action bar */}
      <Box marginTop={1} gap={2}>
        {BOTTOM_ACTIONS.map((action) => {
          const isSelected = inActionBar && selectedAction === action.key;
          return (
            <Box key={action.key}>
              <Text
                color={isSelected ? 'cyan' : undefined}
                bold={isSelected}
                inverse={isSelected}
              >
                {' '}[{action.shortcut}] {action.label}{' '}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Help */}
      {editingStepId ? (
        <Box marginTop={1}>
          <Text dimColor>Type refinement | Enter save | Esc cancel</Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>
            ↑/↓ navigate | Tab actions | Space cycle | D delete | R refine | E edit | Esc cancel
          </Text>
        </Box>
      )}
    </Box>
  );
};
