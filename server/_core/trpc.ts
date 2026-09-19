import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { validateGuestSession } from "./guest-session";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    if (error.code !== "INTERNAL_SERVER_ERROR") return shape;
    const { stack: _stack, ...safeData } = shape.data;
    return {
      ...shape,
      message: "Внутренняя ошибка сервера. Повторите попытку позже.",
      data: safeData,
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

const requireGuest = t.middleware(async opts => {
  const { ctx, next } = opts;

  const guest = await validateGuestSession(ctx.req, ctx.res);
  if (!guest) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Guest session required" });
  }

  const user = await (await import("../db")).getUserById(guest.userId);
  if (!user || user.isGuest !== 1) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Guest session required" });
  }

  return next({
    ctx: {
      ...ctx,
      user,
      isGuest: true,
    },
  });
});

export const guestProcedure = t.procedure.use(requireGuest);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
