import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Button } from "./button"
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, AlertDialogTrigger } from "./alert-dialog"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./dialog"
import { DirectionProvider } from "./direction-provider"
import { IconButton } from "./icon-button"
import { LoadingState } from "./loading-state"

describe("UI foundation", () => {
  it("exposes accessible command semantics and disabled behavior", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(
      <>
        <IconButton aria-label="بحث" onClick={onClick}>?</IconButton>
        <Button disabled onClick={onClick}>حفظ</Button>
      </>
    )

    await user.click(screen.getByRole("button", { name: "بحث" }))
    await user.click(screen.getByRole("button", { name: "حفظ" }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("announces loading state without visual-only text", () => {
    render(<LoadingState label="يتم تحميل العملاء" />)
    expect(screen.getByText("يتم تحميل العملاء").closest("[aria-busy=true]")).not.toBeNull()
  })

  it("opens a modal with an accessible name and closes with Escape", async () => {
    const user = userEvent.setup()
    render(
      <DirectionProvider direction="rtl">
        <Dialog>
          <DialogTrigger render={<Button />}>فتح</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>تفاصيل العميل</DialogTitle>
              <DialogDescription>بيانات تجريبية</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </DirectionProvider>
    )

    const trigger = screen.getByRole("button", { name: "فتح" })
    await user.click(trigger)
    expect(screen.getByRole("dialog", { name: "تفاصيل العميل" })).not.toBeNull()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("closes an alert dialog when its action is confirmed", async () => {
    const user = userEvent.setup()
    render(
      <AlertDialog>
        <AlertDialogTrigger render={<Button />}>حذف</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
          <AlertDialogDescription>لا يمكن التراجع.</AlertDialogDescription>
          <AlertDialogAction>تأكيد</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    )

    await user.click(screen.getByRole("button", { name: "حذف" }))
    expect(screen.getByRole("alertdialog", { name: "تأكيد الحذف" })).not.toBeNull()
    await user.click(screen.getByRole("button", { name: "تأكيد" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })
})
