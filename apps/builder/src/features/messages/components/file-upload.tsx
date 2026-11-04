import type { FileWithPreview } from "@chatbotx.io/filesystem"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import { XCircleIcon } from "lucide-react"
import Image from "next/image"
import { useImperativeHandle } from "react"
import { useDropzone } from "react-dropzone"
import { Controller, useFormContext } from "react-hook-form"

function FileThumb({ file }: { file: FileWithPreview }) {
  if (file.type.startsWith("image")) {
    return (
      <Image
        alt="file"
        className="h-16 w-auto"
        height={64}
        onLoad={() => {
          URL.revokeObjectURL(file.preview)
        }}
        src={file.preview}
        width={64}
      />
    )
  }
  if (file.type.startsWith("audio")) {
    return (
      // biome-ignore lint/a11y/useMediaCaption: agent-recorded voice note preview
      <audio
        className="h-10 max-w-64"
        controls
        preload="metadata"
        src={file.preview}
      />
    )
  }
  return <div className="truncate bg-white px-2 py-1 text-sm">{file.name}</div>
}

export const FileUploadPreview = ({
  ref,
  maxFiles = 1,
}: {
  maxFiles?: number
} & {
  ref: React.RefObject<unknown>
}) => {
  const { control, setValue, getValues } = useFormContext()

  const { getRootProps, getInputProps, open } = useDropzone({
    noClick: true,
    maxFiles,
    maxSize: 5 * 1024 * 1024,
    multiple: maxFiles > 1,
    noKeyboard: true,
    onDrop: (acceptedFiles) => {
      setValue(
        "files",
        acceptedFiles.map((file) =>
          Object.assign(file, {
            preview: URL.createObjectURL(file),
          }),
        ),
      )
    },
  })

  useImperativeHandle(ref, () => ({
    openFileDialog: open,
  }))

  const onRemoveChooseFile = (fileName: string) => {
    const files: FileWithPreview[] = getValues("files")
    const filteredFiles = files.filter((file, _) => file.name !== fileName)
    setValue("files", filteredFiles, { shouldValidate: true })
  }

  const thumbs = getValues("files").map((file: FileWithPreview) => (
    <div className="relative rounded-md border" key={file.name}>
      <div className="max-w-64 overflow-hidden rounded-md">
        <FileThumb file={file} />
      </div>

      <Button
        className="absolute -end-2 -top-2 h-auto rounded-full bg-white p-0 px-0 dark:bg-neutral-600"
        onClick={() => onRemoveChooseFile(file.name)}
        type="button"
        variant="ghost"
      >
        <XCircleIcon />
      </Button>
    </div>
  ))

  return (
    <section className="dropzone-container">
      <Controller
        control={control}
        name="files"
        render={({ field: { onChange } }) => (
          <div {...getRootProps()}>
            <input
              {...getInputProps({
                onChange: (e) => {
                  onChange([e.target.files?.[0]])
                },
              })}
            />
          </div>
        )}
      />
      <aside className="flex items-center gap-2">{thumbs}</aside>
    </section>
  )
}
