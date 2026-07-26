import type { Readable } from "node:stream"
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandInput,
  PutObjectCommand,
  type PutObjectCommandInput,
  S3Client,
} from "@aws-sdk/client-s3"
import { Storage } from "@google-cloud/storage"
import { AwsClient } from "aws4fetch"
import { keys } from "../keys"

const env = keys()

export class Uploader {
  readonly #client: S3Client
  readonly #bucketName: string
  readonly #gcs: Storage | null

  static instance: Uploader

  constructor() {
    this.#gcs = isGoogleCloudStorageEndpoint(env.S3_ENDPOINT)
      ? new Storage()
      : null
    this.#client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
      region: env.S3_REGION,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
    })
    this.#bucketName = env.S3_BUCKET
  }

  get client(): S3Client {
    return this.#client
  }

  get bucketName(): string {
    return this.#bucketName
  }

  get accessKeyId(): string {
    return env.S3_ACCESS_KEY_ID ?? ""
  }

  get endpoint(): string | undefined {
    return env.S3_ENDPOINT
  }
  get region(): string {
    return env.S3_REGION
  }

  get secretAccessKey(): string {
    return env.S3_SECRET_ACCESS_KEY ?? ""
  }

  static getInstance(): Uploader {
    if (!Uploader.instance) {
      Uploader.instance = new Uploader()
    }
    return Uploader.instance
  }

  async putObject(
    path: string,
    body: string | Uint8Array | Buffer | Readable,
    options?: Partial<PutObjectCommandInput>,
  ) {
    if (this.#gcs) {
      const file = this.#gcs.bucket(this.#bucketName).file(path)
      const metadata = options?.ContentType
        ? { contentType: options.ContentType }
        : undefined

      if (typeof body === "string" || body instanceof Uint8Array) {
        await file.save(body, {
          metadata,
          resumable: false,
          // CRC32C validation is unreliable in the current Cloud Run/Node
          // runtime and causes GCS to delete valid WhatsApp media uploads.
          // MD5 still provides end-to-end integrity validation.
          validation: "md5",
        })
        return {}
      }

      await new Promise<void>((resolve, reject) => {
        const writeStream = file.createWriteStream({
          metadata,
          resumable: false,
          validation: "md5",
        })
        body.on("error", reject)
        writeStream.on("error", reject)
        writeStream.on("finish", resolve)
        body.pipe(writeStream)
      })
      return {}
    }

    const command = new PutObjectCommand({
      Bucket: this.#bucketName,
      Key: path,
      Body: body,
      ...options,
    })

    return await this.#client.send(command)
  }

  async getPresignedUpload(filePath: string): Promise<string> {
    if (this.#gcs) {
      const [url] = await this.#gcs
        .bucket(this.#bucketName)
        .file(filePath)
        .getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 5 * 60 * 1000,
        })
      return url
    }

    const client = new AwsClient({
      service: "s3",
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    })

    return (
      await client.sign(
        new Request(
          `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${filePath}?X-Amz-Expires=${5 * 60}`,
          {
            method: "PUT",
          },
        ),
        {
          aws: { signQuery: true },
        },
      )
    ).url.toString()
  }

  async getPresignedDownload(
    filePath: string,
    expiresInSeconds = 60 * 60,
  ): Promise<string> {
    if (this.#gcs) {
      const [url] = await this.#gcs
        .bucket(this.#bucketName)
        .file(filePath)
        .getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + expiresInSeconds * 1000,
        })
      return url
    }

    const client = new AwsClient({
      service: "s3",
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    })

    return (
      await client.sign(
        new Request(
          `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${filePath}?X-Amz-Expires=${expiresInSeconds}`,
          {
            method: "GET",
          },
        ),
        {
          aws: { signQuery: true },
        },
      )
    ).url.toString()
  }

  async headObject(path: string) {
    if (this.#gcs) {
      const [metadata] = await this.#gcs
        .bucket(this.#bucketName)
        .file(path)
        .getMetadata()
      return { ContentLength: Number(metadata.size ?? 0) }
    }

    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: path,
    })

    return await this.#client.send(command)
  }

  async getObject(path: string): Promise<Buffer> {
    if (this.#gcs) {
      const [buffer] = await this.#gcs
        .bucket(this.#bucketName)
        .file(path)
        .download()
      return buffer
    }

    const command = new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: path,
    })

    const response = await this.#client.send(command)

    if (!response.Body) {
      throw new Error(`No body found for object: ${path}`)
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = []
    const stream = response.Body as Readable

    return new Promise((resolve, reject) => {
      stream.on("data", (chunk) => chunks.push(chunk))
      stream.on("error", reject)
      stream.on("end", () => resolve(Buffer.concat(chunks)))
    })
  }

  async getObjectStream(
    path: string,
  ): Promise<{ stream: Readable; contentLength?: number }> {
    if (this.#gcs) {
      const file = this.#gcs.bucket(this.#bucketName).file(path)
      const [metadata] = await file.getMetadata()
      return {
        stream: file.createReadStream(),
        contentLength: Number(metadata.size ?? 0),
      }
    }

    const command = new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: path,
    })

    const response = await this.#client.send(command)
    if (!response.Body) {
      throw new Error(`No body found for object: ${path}`)
    }
    return {
      stream: response.Body as Readable,
      contentLength: response.ContentLength,
    }
  }

  async copyObject(sourcePath: string, destinationPath: string) {
    if (this.#gcs) {
      await this.#gcs
        .bucket(this.#bucketName)
        .file(sourcePath)
        .copy(this.#gcs.bucket(this.#bucketName).file(destinationPath))
      return {}
    }

    const encodedSource = sourcePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")

    const command = new CopyObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: destinationPath,
      CopySource: `${env.S3_BUCKET}/${encodedSource}`,
    })

    return await this.#client.send(command)
  }

  async deleteObject(path: string) {
    if (this.#gcs) {
      await this.#gcs
        .bucket(this.#bucketName)
        .file(path)
        .delete({ ignoreNotFound: true })
      return {}
    }

    const command = new DeleteObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: path,
    })
    return await this.#client.send(command)
  }

  async listObjects(
    prefix: string,
    options: Partial<ListObjectsV2CommandInput> = {},
  ) {
    if (this.#gcs) {
      const [files] = await this.#gcs.bucket(this.#bucketName).getFiles({
        prefix,
        maxResults: options.MaxKeys,
        pageToken: options.ContinuationToken,
      })
      return {
        Contents: files.map((file) => ({ Key: file.name })),
      }
    }

    const command = new ListObjectsV2Command({
      ...options,
      Bucket: env.S3_BUCKET,
      Prefix: prefix,
    })
    return await this.#client.send(command)
  }
}

export function isGoogleCloudStorageEndpoint(endpoint?: string): boolean {
  if (!endpoint) {
    return false
  }

  try {
    return new URL(endpoint).hostname === "storage.googleapis.com"
  } catch {
    return false
  }
}

export const uploader = Uploader.getInstance()
