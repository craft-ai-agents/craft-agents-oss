import { cn } from "@/lib/utils"
import { Key, Monitor } from "lucide-react"
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { StepFormLayout } from "./primitives"

import claudeIcon from "@/assets/provider-icons/claude.svg"
import openaiIcon from "@/assets/provider-icons/openai.svg"
import copilotIcon from "@/assets/provider-icons/copilot.svg"

/**
 * The high-level provider choice the user makes on first launch.
 * This maps to one or more ApiSetupMethods downstream.
 */
export type ProviderChoice = 'claude' | 'chatgpt' | 'copilot' | 'api_key' | 'local'

interface ProviderOption {
  id: ProviderChoice
  name: string
  description: string
  icon: React.ReactNode
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    id: 'claude',
    name: 'Claude Pro / Max',
    description: 'Use your Anthropic subscription.',
    icon: <img src={claudeIcon} alt="" className="size-5 rounded-[3px]" />,
  },
  {
    id: 'chatgpt',
    name: 'Codex · ChatGPT Plus',
    description: 'Use your ChatGPT Plus or Pro subscription.',
    icon: <img src={openaiIcon} alt="" className="size-5 rounded-[3px]" />,
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    description: 'Use your GitHub Copilot subscription.',
    icon: <img src={copilotIcon} alt="" className="size-5 rounded-[3px]" />,
  },
  {
    id: 'api_key',
    name: 'I use other provider',
    description: 'Anthropic, AWS Bedrock, OpenRouter, Google or any compatible provider.',
    icon: <Key className="size-5" />,
  },
  {
    id: 'local',
    name: 'Local model',
    description: 'Run models locally with Ollama.',
    icon: <Monitor className="size-5" />,
  },
]

interface ProviderSelectStepProps {
  /** Called when the user selects a provider */
  onSelect: (choice: ProviderChoice) => void
  /** Called when the user chooses to skip setup */
  onSkip?: () => void
}

/**
 * ProviderSelectStep — First screen after install.
 *
 * Welcomes the user and asks them to pick their subscription / auth method.
 * Selecting a card immediately advances to the next step.
 */
export function ProviderSelectStep({ onSelect, onSkip }: ProviderSelectStepProps) {
  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-10 text-accent" />
        </div>
      }
      title="Welcome to Craft Agents"
      description="How would you like to connect?"
    >
      <div className="space-y-3">
        {PROVIDER_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => onSelect(option.id)}
            className={cn(
              "flex w-full items-start gap-4 rounded-xl bg-foreground-2 p-4 text-left transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "hover:bg-foreground/[0.02] shadow-minimal",
            )}
          >
            {/* Icon */}
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {option.icon}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <span className="font-medium text-sm">{option.name}</span>
              <p className="mt-0 text-xs text-muted-foreground">
                {option.description}
              </p>
            </div>
          </button>
        ))}
      </div>

      {onSkip && (
        <div className="mt-4 text-center">
          <button
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Setup later
          </button>
        </div>
      )}
    </StepFormLayout>
  )
}
