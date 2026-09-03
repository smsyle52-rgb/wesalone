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
import {
  BlobSASPermissions,
  BlobServiceClient,
  type ContainerClient,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
} from "@azure/storage-blob"
import { Storage } from "@google-cloud/storage"
import { AwsClient } from "aws4fetch"
import { keys } from "../keys"
import { buildCopySource } from "./copy-source"

const env = keys()

export class Uploader {
  readonly #client: S3Client
  readonly #bucketName: string
  readonly #gcs: Storage | null
  readonly #azure: ContainerClient | null
  readonly #azureAccountName: string | null
  readonly #azureCredential: StorageSharedKeyCredential | null

  static instance: Uploader

  constructor() {
    this.#gcs = isGoogleCloudStorageEndpoint(env.S3_ENDPOINT)
      ? new Storage()
      : null

    const azureConnectionString = env.AZURE_STORAGE_CONNECTION_STRING
    this.#azure = isAzureBlobStorageConfigured(azureConnectionString)
      ? BlobServiceClient.fromConnectionString(
          azureConnectionString,
        ).getContainerClient(env.AZURE_STORAGE_CONTAINER ?? "uploads")
      : null
    this.#azureAccountName = azureConnectionString
      ? getAzureConnectionSetting(azureConnectionString, "AccountName")
      : null
    const azureAccountKey = azureConnectionString
      ? getAzureConnectionSetting(azureConnectionString, "AccountKey")
      : null
    this.#azureCredential =
      this.#azureAccountName && azureAccountKey
        ? new StorageSharedKeyCredential(
            this.#azureAccountName,
            azureAccountKey,
          )
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
      region: env.S3_REGION ?? "us-east-1",
      forcePathStyle: Boolean(env.S3_ENDPOINT),
    })
    this.#bucketName = this.#azure
      ? (env.AZURE_STORAGE_CONTAINER ?? "uploads")
      : (env.S3_BUCKET ?? "")
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
    return env.S3_REGION ?? "us-east-1"
  }

  get secretAccessKey(): string {
    return env.S3_SECRET_ACCESS_KEY ?? ""
  }

  get isAzureBlob(): boolean {
    return this.#azure !== null
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
    if (this.#azure) {
      const blob = this.#azure.getBlockBlobClient(path)
      const blobHTTPHeaders = options?.ContentType
        ? { blobContentType: options.ContentType }
        : undefined

      if (isReadable(body)) {
        await blob.uploadStream(body, undefined, undefined, { blobHTTPHeaders })
      } else {
        const data = typeof body === "string" ? Buffer.from(body) : body
        await blob.uploadData(data, { blobHTTPHeaders })
      }
      return {}
    }

    if (this.#gcs) {
      const file = this.#gcs.bucket(this.#bucketName).file(path)
      const metadata = options?.ContentType
        ? { contentType: options.ContentType }
        : undefined

      if (typeof body === "string" || body instanceof Uint8Array) {
        await this.#putRawGcsObject(path, body, options?.ContentType)
        return {}
      }

      await new Promise<void>((resolve, reject) => {
        const writeStream = file.createWriteStream({
          metadata,
          resumable: true,
          validation: false,
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

  async #putRawGcsObject(
    path: string,
    body: string | Uint8Array,
    contentType?: string,
  ): Promise<void> {
    if (!this.#gcs) {
      throw new Error("Google Cloud Storage is not configured")
    }

    const accessToken = await this.#gcs.authClient.getAccessToken()
    if (!accessToken) {
      throw new Error("Unable to obtain Google Cloud Storage access token")
    }

    const url = new URL(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.#bucketName)}/o`,
    )
    url.searchParams.set("uploadType", "media")
    url.searchParams.set("name", path)

    const requestBody =
      typeof body === "string" ? body : Uint8Array.from(body).buffer

    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": contentType ?? "application/octet-stream",
      },
      body: requestBody,
    })

    if (!response.ok) {
      const details = await response.text()
      throw new Error(
        `Google Cloud Storage media upload failed (${response.status}): ${details.slice(0, 500)}`,
      )
    }
  }

  async getPresignedUpload(filePath: string): Promise<string> {
    if (this.#azure) {
      return this.#getAzureSasUrl(filePath, "cw", 5 * 60)
    }

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
      region: env.S3_REGION ?? "us-east-1",
      accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    })

    return (
      await client.sign(
        new Request(
          `${env.S3_ENDPOINT}/${this.#bucketName}/${filePath}?X-Amz-Expires=${5 * 60}`,
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
    if (this.#azure) {
      return this.#getAzureSasUrl(filePath, "r", expiresInSeconds)
    }

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
      region: env.S3_REGION ?? "us-east-1",
      accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    })

    return (
      await client.sign(
        new Request(
          `${env.S3_ENDPOINT}/${this.#bucketName}/${filePath}?X-Amz-Expires=${expiresInSeconds}`,
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

  #getAzureSasUrl(
    filePath: string,
    permissions: string,
    expiresInSeconds: number,
  ): string {
    if (!(this.#azure && this.#azureCredential && this.#azureAccountName)) {
      throw new Error(
        "Azure Blob signed URLs require a connection string with AccountName and AccountKey",
      )
    }

    const startsOn = new Date(Date.now() - 5 * 60 * 1000)
    const expiresOn = new Date(Date.now() + expiresInSeconds * 1000)
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.#bucketName,
        blobName: filePath,
        permissions: BlobSASPermissions.parse(permissions),
        startsOn,
        expiresOn,
      },
      this.#azureCredential,
    ).toString()

    return `${this.#azure.getBlockBlobClient(filePath).url}?${sas}`
  }

  async headObject(path: string) {
    if (this.#azure) {
      const properties = await this.#azure.getBlobClient(path).getProperties()
      return { ContentLength: properties.contentLength }
    }

    if (this.#gcs) {
      const [metadata] = await this.#gcs
        .bucket(this.#bucketName)
        .file(path)
        .getMetadata()
      return { ContentLength: Number(metadata.size ?? 0) }
    }

    const command = new HeadObjectCommand({
      Bucket: this.#bucketName,
      Key: path,
    })

    return await this.#client.send(command)
  }

  async getObject(path: string): Promise<Buffer> {
    if (this.#azure) {
      return await this.#azure.getBlobClient(path).downloadToBuffer()
    }

    if (this.#gcs) {
      const [buffer] = await this.#gcs
        .bucket(this.#bucketName)
        .file(path)
        .download()
      return buffer
    }

    const command = new GetObjectCommand({
      Bucket: this.#bucketName,
      Key: path,
    })

    const response = await this.#client.send(command)

    if (!response.Body) {
      throw new Error(`No body found for object: ${path}`)
    }

    const chunks: Uint8Array[] = []
    const stream = response.Body as Readable

    return await new Promise((resolve, reject) => {
      stream.on("data", (chunk) => chunks.push(chunk))
      stream.on("error", reject)
      stream.on("end", () => resolve(Buffer.concat(chunks)))
    })
  }

  async getObjectStream(
    path: string,
  ): Promise<{ stream: Readable; contentLength?: number }> {
    if (this.#azure) {
      const response = await this.#azure.getBlobClient(path).download()
      if (!response.readableStreamBody) {
        throw new Error(`No body found for object: ${path}`)
      }
      return {
        stream: response.readableStreamBody as Readable,
        contentLength: response.contentLength,
      }
    }

    if (this.#gcs) {
      const file = this.#gcs.bucket(this.#bucketName).file(path)
      const [metadata] = await file.getMetadata()
      return {
        stream: file.createReadStream(),
        contentLength: Number(metadata.size ?? 0),
      }
    }

    const command = new GetObjectCommand({
      Bucket: this.#bucketName,
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
    if (this.#azure) {
      const source = this.#azure.getBlobClient(sourcePath)
      const destination = this.#azure.getBlobClient(destinationPath)
      const poller = await destination.beginCopyFromURL(source.url)
      await poller.pollUntilDone()
      return {}
    }

    if (this.#gcs) {
      await this.#gcs
        .bucket(this.#bucketName)
        .file(sourcePath)
        .copy(this.#gcs.bucket(this.#bucketName).file(destinationPath))
      return {}
    }

    const command = new CopyObjectCommand({
      Bucket: this.#bucketName,
      Key: destinationPath,
      CopySource: buildCopySource(
        sourcePath,
        this.#bucketName,
        env.S3_ENDPOINT,
      ),
    })

    return await this.#client.send(command)
  }

  async deleteObject(path: string) {
    if (this.#azure) {
      await this.#azure.deleteBlob(path, { deleteSnapshots: "include" })
      return {}
    }

    if (this.#gcs) {
      await this.#gcs
        .bucket(this.#bucketName)
        .file(path)
        .delete({ ignoreNotFound: true })
      return {}
    }

    const command = new DeleteObjectCommand({
      Bucket: this.#bucketName,
      Key: path,
    })
    return await this.#client.send(command)
  }

  async listObjects(
    prefix: string,
    options: Partial<ListObjectsV2CommandInput> = {},
  ) {
    if (this.#azure) {
      const pages = this.#azure.listBlobsFlat({ prefix }).byPage({
        continuationToken: options.ContinuationToken,
        maxPageSize: options.MaxKeys,
      })
      const page = await pages.next()
      const response = page.value
      // The SDK's page iterator is loosely typed, so annotate the mapped result:
      // without it `Contents` widens to `any` and every caller that reads it
      // inherits an implicit-any parameter.
      const contents: { Key: string }[] = (
        response?.segment.blobItems ?? []
      ).map((blob: { name: string }) => ({ Key: blob.name }))
      return {
        Contents: contents,
        NextContinuationToken: response?.continuationToken,
        // Callers page with `IsTruncated`, the S3 shape. Azure signals
        // "more pages" with a continuation token instead, so translate it
        // here rather than making every caller special-case the provider.
        IsTruncated: Boolean(response?.continuationToken),
      }
    }

    if (this.#gcs) {
      const [files] = await this.#gcs.bucket(this.#bucketName).getFiles({
        prefix,
        maxResults: options.MaxKeys,
        pageToken: options.ContinuationToken,
      })
      return {
        Contents: files.map((file) => ({ Key: file.name })),
        // getFiles without autoPaginate already returned every match, so
        // there is never a further page to fetch.
        NextContinuationToken: undefined as string | undefined,
        IsTruncated: false,
      }
    }

    const command = new ListObjectsV2Command({
      ...options,
      Bucket: this.#bucketName,
      Prefix: prefix,
    })
    return await this.#client.send(command)
  }
}

function getAzureConnectionSetting(
  connectionString: string,
  name: string,
): string | null {
  const prefix = `${name}=`
  const setting = connectionString
    .split(";")
    .find((part) => part.startsWith(prefix))
  return setting ? setting.slice(prefix.length) : null
}

function isReadable(value: unknown): value is Readable {
  return (
    typeof value === "object" &&
    value !== null &&
    "pipe" in value &&
    typeof value.pipe === "function"
  )
}

export function isAzureBlobStorageConfigured(
  connectionString?: string,
): connectionString is string {
  return Boolean(connectionString?.trim())
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
