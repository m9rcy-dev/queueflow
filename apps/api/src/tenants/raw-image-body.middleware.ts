import { HttpException, HttpStatus, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { MAX_LOGO_BYTES } from "./tenant-logo.service";

/**
 * Reads the logo upload's raw body into a Buffer (`req.body`), refusing
 * anything past a hard limit while still streaming — so a huge upload is
 * cut off early instead of being buffered whole. Registered by AppModule
 * for `PUT tenants/me/logo` only; Nest's own JSON parser ignores image
 * content types, so the stream is untouched when this runs.
 */
@Injectable()
export class RawImageBodyMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    // A little headroom over the limit, so TenantLogoService can give the
    // friendly "500 KB or smaller" error for a just-too-big file.
    const hardLimit = MAX_LOGO_BYTES + 64 * 1024;
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;

    req.on("data", (chunk: Buffer) => {
      if (finished) return;
      size += chunk.length;
      if (size > hardLimit) {
        finished = true;
        req.removeAllListeners("data");
        req.resume();
        next(
          new HttpException(
            { code: "LOGO_TOO_LARGE", message: "The logo must be 500 KB or smaller." },
            HttpStatus.PAYLOAD_TOO_LARGE,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (finished) return;
      finished = true;
      req.body = Buffer.concat(chunks);
      next();
    });
    req.on("error", (err) => {
      if (finished) return;
      finished = true;
      next(err);
    });
  }
}
