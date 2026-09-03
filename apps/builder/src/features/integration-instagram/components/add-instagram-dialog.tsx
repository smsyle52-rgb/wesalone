"use client"

import { Button, buttonVariants } from "@chatbotx.io/ui/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@chatbotx.io/ui/components/ui/dialog"
import { PlusCircleIcon } from "lucide-react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { AddChannelButton } from "@/features/inboxes/components/add-channel-button"

type AddInstagramDialogProps = {
  canCreate?: boolean
  workspaceId?: string | null
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function FacebookIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-12"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill="#1877F2" height="24" rx="6" width="24" />
      <path
        d="M16 8h-2a1 1 0 0 0-1 1v2h3l-.5 3H13v7h-3v-7H8v-3h2V9a4 4 0 0 1 4-4h2v3z"
        fill="white"
      />
    </svg>
  )
}

function DialogBody({ workspaceId }: { workspaceId?: string | null }) {
  const t = useTranslations()

  return (
    // The Instagram-login card is deliberately not offered. That flow posts
    // this deployment's Facebook app id to `instagram.com/oauth/authorize`,
    // which answers `Invalid platform app`, and it asks for
    // `instagram_business_*` scopes this app was never granted. It is the more
    // recognisable of the two cards, so merchants reached for it first and hit
    // a dead end every time. Restore it only alongside a real Instagram app id
    // and an approved `instagram_business_*` review.
    <div className="grid gap-4">
      <div className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center">
        <FacebookIcon />
        <h3 className="font-semibold">
          {t("fields.instagram.facebookLoginTitle")}
        </h3>
        <p className="flex-1 text-muted-foreground text-sm">
          {t("fields.instagram.facebookLoginDescription")}
        </p>
        <Link
          className={buttonVariants({
            variant: "secondary",
            className: "w-full",
          })}
          href={`/channels/create?channel=instagram-facebook${workspaceId ? `&workspaceId=${workspaceId}` : ""}`}
        >
          {t("fields.instagram.facebookLoginTitle")}
        </Link>
      </div>
    </div>
  )
}

export function AddInstagramDialog({
  canCreate = true,
  workspaceId,
  defaultOpen,
  open,
  onOpenChange,
}: AddInstagramDialogProps) {
  const t = useTranslations()

  const isControlled = open !== undefined

  if (isControlled) {
    return (
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("actions.addFeature", {
                feature: t("fields.instagram.label"),
              })}
            </DialogTitle>
          </DialogHeader>
          <DialogBody workspaceId={workspaceId} />
        </DialogContent>
      </Dialog>
    )
  }

  if (!canCreate) {
    return (
      <AddChannelButton canCreate={false} label={t("fields.instagram.label")} />
    )
  }

  return (
    <Dialog defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="secondary">
            <PlusCircleIcon className="h-4 w-4" />
            {t("actions.addFeature", { feature: t("fields.instagram.label") })}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("actions.addFeature", {
              feature: t("fields.instagram.label"),
            })}
          </DialogTitle>
        </DialogHeader>
        <DialogBody workspaceId={workspaceId} />
      </DialogContent>
    </Dialog>
  )
}
