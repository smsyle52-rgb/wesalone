import { zodBigintAsString } from "@chatbotx.io/utils"
import {
  createSearchParamsCache,
  parseAsInteger,
  parseAsString,
} from "nuqs/server"
import { z } from "zod"
import { userResource } from "@/features/users/schema/resource"
import { basePaginationRequest } from "@/lib/pagination"
import { workspaceMemberResource } from "./resource"

export const getWorkspaceMembersSearchParamsCache = createSearchParamsCache({
  // Match the table's client defaults (page 1, 10 rows) — the table clears
  // default values from the URL, so a bare page would otherwise get 20 rows.
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(10),
  keyword: parseAsString,
})

export type GetWorkspaceMembersSchema = Awaited<
  ReturnType<typeof getWorkspaceMembersSearchParamsCache.parse>
> & {
  workspaceId: string
}

export const listWorkspaceMembersRequest = basePaginationRequest.extend({
  workspaceId: zodBigintAsString(),
  keyword: z
    .string()
    .nullish()
    .default(null)
    .describe(
      "Case-insensitive substring match against the member's name or email.",
    ),
})
export type ListWorkspaceMembersRequest = z.infer<
  typeof listWorkspaceMembersRequest
>

export const listWorkspaceMembersResponse = z.object({
  data: z.array(
    workspaceMemberResource.extend({
      user: userResource.pick({ id: true, name: true, image: true }),
    }),
  ),
  pageCount: z.number(),
})
export type ListWorkspaceMembersResponse = z.infer<
  typeof listWorkspaceMembersResponse
>

export const getWorkspaceMemberRequest = z.object({
  memberId: zodBigintAsString().describe(
    "Workspace member id. Get it from `workspaceMembers.list`.",
  ),
  workspaceId: zodBigintAsString(),
})
export type GetWorkspaceMemberRequest = z.infer<
  typeof getWorkspaceMemberRequest
>

export const getWorkspaceMemberResponse = workspaceMemberResource.extend({
  user: userResource.pick({ id: true, name: true, image: true }),
})
export type GetWorkspaceMemberResponse = z.infer<
  typeof getWorkspaceMemberResponse
>
