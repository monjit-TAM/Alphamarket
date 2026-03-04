import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { Response } from "express";

const UPLOAD_DIR = "/var/www/alphamarket/uploads";

["certificates", "general"].forEach((sub) => {
  const dir = path.join(UPLOAD_DIR, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  async getObjectEntityUploadURL(): Promise<string> {
    const id = randomUUID();
    return `/api/uploads/put/${id}`;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    const id = rawPath.split("/").pop();
    return `/objects/uploads/${id}`;
  }

  async downloadObject(objectPath: string, res: Response): Promise<void> {
    const id = objectPath.replace(/^\/objects\/uploads\//, "");
    if (!id) throw new ObjectNotFoundError();
    let found: string | null = null;
    for (const sub of fs.readdirSync(UPLOAD_DIR)) {
      const subDir = path.join(UPLOAD_DIR, sub);
      if (!fs.statSync(subDir).isDirectory()) continue;
      const match = fs.readdirSync(subDir).find((f) => f.startsWith(id));
      if (match) { found = path.join(subDir, match); break; }
    }
    if (!found || !fs.existsSync(found)) throw new ObjectNotFoundError();
    const mime: Record<string, string> = {
      ".pdf": "application/pdf",
      ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    res.setHeader("Content-Type", mime[path.extname(found).toLowerCase()] || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=3600");
    fs.createReadStream(found).pipe(res);
  }

  async writeFile(id: string, buffer: Buffer, originalName: string): Promise<string> {
    const ext = path.extname(originalName) || "";
    const lower = originalName.toLowerCase();
    const sub = (lower.includes("cert") || lower.includes("sebi") || lower.includes("reg")) ? "certificates" : "general";
    fs.writeFileSync(path.join(UPLOAD_DIR, sub, `${id}${ext}`), buffer);
    return `/objects/uploads/${id}`;
  }
}
