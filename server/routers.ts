import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { PROVIDER_IDS, chatWithProvider, getProviderViews, getPublicProviderError } from "./providers";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(16_000),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  providers: router({
    list: publicProcedure.query(() => getProviderViews()),
  }),
  chat: publicProcedure
    .input(z.object({ provider: z.union([z.enum(PROVIDER_IDS), z.literal("auto")]), messages: z.array(messageSchema).min(1).max(80) }))
    .mutation(async ({ input }) => {
      try {
        return await chatWithProvider(input.provider, input.messages);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: getPublicProviderError(input.provider, error) });
      }
    }),
});

export type AppRouter = typeof appRouter;
