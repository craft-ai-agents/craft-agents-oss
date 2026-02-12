/**
 * BedrockIamInput - AWS Bedrock IAM credential entry form
 *
 * Fields: Access Key ID, Secret Access Key, Region (dropdown), Session Token (optional)
 *
 * Does NOT include layout wrappers or action buttons — the parent
 * controls placement via the form ID ("bedrock-iam-form") for submit binding.
 *
 * Used in: Onboarding CredentialsStep, Settings API dialog
 */

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from "@/components/ui/styled-dropdown"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, Eye, EyeOff } from "lucide-react"
import { useLocale } from "@/context/LocaleContext"

export type BedrockIamStatus = 'idle' | 'validating' | 'success' | 'error'

export interface BedrockIamSubmitData {
  accessKeyId: string
  secretAccessKey: string
  region: string
  sessionToken?: string
}

export interface BedrockIamInputProps {
  status: BedrockIamStatus
  errorMessage?: string
  onSubmit: (data: BedrockIamSubmitData) => void
  formId?: string
  disabled?: boolean
}

const AWS_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-south-1',
  'ca-central-1',
  'sa-east-1',
]

export function BedrockIamInput({
  status,
  errorMessage,
  onSubmit,
  formId = "bedrock-iam-form",
  disabled,
}: BedrockIamInputProps) {
  const { t } = useLocale()
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [region, setRegion] = useState('us-east-1')
  const [sessionToken, setSessionToken] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [showSessionToken, setShowSessionToken] = useState(false)

  const isDisabled = disabled || status === 'validating'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secretAccessKey.trim(),
      region,
      sessionToken: sessionToken.trim() || undefined,
    })
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
      {/* AWS Access Key ID */}
      <div className="space-y-2">
        <Label htmlFor="aws-access-key-id">{t('apiSetup.bedrock.accessKeyId')}</Label>
        <div className={cn(
          "relative rounded-md shadow-minimal transition-colors",
          "bg-foreground-2 focus-within:bg-background"
        )}>
          <Input
            id="aws-access-key-id"
            type="text"
            value={accessKeyId}
            onChange={(e) => setAccessKeyId(e.target.value)}
            placeholder="AKIAIOSFODNN7EXAMPLE"
            className={cn(
              "border-0 bg-transparent shadow-none",
              status === 'error' && "focus-visible:ring-destructive"
            )}
            disabled={isDisabled}
            autoFocus
          />
        </div>
      </div>

      {/* AWS Secret Access Key */}
      <div className="space-y-2">
        <Label htmlFor="aws-secret-access-key">{t('apiSetup.bedrock.secretAccessKey')}</Label>
        <div className={cn(
          "relative rounded-md shadow-minimal transition-colors",
          "bg-foreground-2 focus-within:bg-background"
        )}>
          <Input
            id="aws-secret-access-key"
            type={showSecret ? 'text' : 'password'}
            value={secretAccessKey}
            onChange={(e) => setSecretAccessKey(e.target.value)}
            placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
            className={cn(
              "pr-10 border-0 bg-transparent shadow-none",
              status === 'error' && "focus-visible:ring-destructive"
            )}
            disabled={isDisabled}
          />
          <button
            type="button"
            onClick={() => setShowSecret(!showSecret)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      {/* AWS Region */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t('apiSetup.bedrock.region')}</Label>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={isDisabled}
              className="flex h-6 items-center gap-1 rounded-[6px] bg-background shadow-minimal pl-2.5 pr-2 text-[12px] font-medium text-foreground/50 hover:bg-foreground/5 hover:text-foreground focus:outline-none"
            >
              {region}
              <ChevronDown className="size-2.5 opacity-50" />
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end" className="z-floating-menu max-h-64 overflow-y-auto">
              {AWS_REGIONS.map((r) => (
                <StyledDropdownMenuItem
                  key={r}
                  onClick={() => setRegion(r)}
                  className="justify-between"
                >
                  {r}
                  <Check className={cn("size-3", region === r ? "opacity-100" : "opacity-0")} />
                </StyledDropdownMenuItem>
              ))}
            </StyledDropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* AWS Session Token (optional) */}
      <div className="space-y-2">
        <Label htmlFor="aws-session-token" className="text-muted-foreground font-normal">
          {t('apiSetup.bedrock.sessionToken')} <span className="text-foreground/30">· {t('apiSetup.bedrock.optional')}</span>
        </Label>
        <div className={cn(
          "relative rounded-md shadow-minimal transition-colors",
          "bg-foreground-2 focus-within:bg-background"
        )}>
          <Input
            id="aws-session-token"
            type={showSessionToken ? 'text' : 'password'}
            value={sessionToken}
            onChange={(e) => setSessionToken(e.target.value)}
            placeholder={t('apiSetup.bedrock.sessionTokenPlaceholder')}
            className="pr-10 border-0 bg-transparent shadow-none"
            disabled={isDisabled}
          />
          <button
            type="button"
            onClick={() => setShowSessionToken(!showSessionToken)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {showSessionToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      {/* Error message */}
      {status === 'error' && errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
    </form>
  )
}
