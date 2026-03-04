import express, { type Express, type Request, type Response } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";

export function registerObjectStorageRoutes(app: Express): void {
  const svc = new ObjectStorageService();

  app.post("/api/uploads/request-url", async (req: Request, res: Response) => {
    try {
      const { name, size, contentType } = req.body;
      if (!name) return res.status(400).json({ error: "Missing required field: name" });
      const uploadURL = await svc.getObjectEntityUploadURL();
      const objectPath = svc.normalizeObjectEntityPath(uploadURL);
      return res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
    } catch (err) {
      console.error("Error generating upload URL:", err);
      return res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  app.put(
    "/api/uploads/put/:id",
    express.raw({ type: "*/*", limit: "11mb" }),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const originalName = (req.headers["x-file-name"] as string) || "upload-" + id;
        const buffer = req.body as Buffer;
        if (!buffer || buffer.length === 0) {
          return res.status(400).json({ error: "Empty file body" });
        }
        const objectPath = await svc.writeFile(id, buffer, originalName);
        return res.json({ success: true, objectPath });
      } catch (err) {
        console.error("PUT upload error:", err);
        return res.status(500).json({ error: "Upload failed" });
      }
    }
  );

  app.get(/^\/objects\/(.+)$/, async (req: Request, res: Response) => {
    try {
      await svc.downloadObject(req.path, res);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return res.status(404).json({ error: "Object not found" });
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}
