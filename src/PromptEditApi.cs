using FreneticUtilities.FreneticExtensions;
using SwarmUI.Accounts;
using SwarmUI.Core;
using SwarmUI.Media;
using SwarmUI.Text2Image;
using SwarmUI.Utils;
using SwarmUI.WebAPI;
using Newtonsoft.Json.Linq;
using System.IO;

namespace WhatTheDuck;

/// <summary>API endpoint to rewrite the positive prompt embedded in an already-generated image file's metadata.</summary>
public static class PromptEditApi
{
    /// <summary>Rewrites the positive prompt inside an existing image file's metadata, preserving the file's format and the user's format settings. Only PNG and JPG are supported.</summary>
    public static async Task<JObject> WhatTheDuckEditPrompt(Session session, string path, string prompt)
    {
        try
        {
            // 1. Resolve & validate the path (mirrors the DeleteImage idiom, T2IAPI.cs).
            string origPath = path;
            string root = Utilities.CombinePathWithAbsolute(Environment.CurrentDirectory, session.User.OutputDirectory);
            (path, string consoleError, string userError) = WebServer.CheckFilePath(root, path);
            if (consoleError is not null)
            {
                Logs.Error(consoleError);
                return new JObject { ["success"] = false, ["error"] = userError };
            }
            path = UserImageHistoryHelper.GetRealPathFor(session.User, path, root: root);
            if (!File.Exists(path))
            {
                Logs.Warning($"User {session.User.UserID} tried to edit the prompt of image path '{origPath}' which maps to '{path}', but cannot as the image does not exist.");
                return new JObject { ["success"] = false, ["error"] = "That file does not exist." };
            }

            // 2. Format gate: preserve the file's existing container. WEBP is typed as an
            // animation and needs the still-frame handling in step 8; other formats can't
            // round-trip through ConvertTo.
            string ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
            string format = ext switch
            {
                "png" => "PNG",
                "jpg" => "JPG",
                "jpeg" => "JPG",
                "webp" => "WEBP_LOSSLESS",
                _ => null
            };
            if (format is null)
            {
                return new JObject { ["success"] = false, ["error"] = "Editing the prompt is only supported for PNG, JPG, and WEBP images." };
            }

            // 3. Concurrency guard: if the file is still being written by an in-flight save, wait for it to finish first.
            string standardizedPath = Path.GetFullPath(path);
            if (Session.StillSavingFiles.TryGetValue(standardizedPath, out Task<byte[]> savingTask))
            {
                try
                {
                    await savingTask;
                }
                catch (Exception)
                {
                    // The save may have failed; we still attempt to read whatever exists on disk.
                }
            }

            // 4. Read the existing image and its embedded metadata.
            MediaType mediaType = MediaType.GetByExtension(ext);
            if (mediaType is null)
            {
                return new JObject { ["success"] = false, ["error"] = "Unrecognized image format." };
            }
            byte[] bytes = File.ReadAllBytes(path);
            ImageFile img = new Image(bytes, mediaType);
            string raw = img.GetMetadata();
            JObject full = raw?.ParseToJson();

            // 5. Validate the metadata structure.
            if (full is null || full["sui_image_params"] is not JObject imageParams)
            {
                return new JObject { ["success"] = false, ["error"] = "Image has no editable SwarmUI metadata." };
            }

            // 6. Apply the edit; preserve every other field.
            imageParams["prompt"] = prompt;
            // Remove any stale pre-edit cache so the display does not silently revert the edit.
            if (full["sui_extra_data"] is JObject extra)
            {
                extra.Remove("original_prompt");
            }

            // 7. Serialize with the same formatting core uses for metadata.
            string newMeta = T2IParamInput.MetadataToString(full);
            if (string.IsNullOrEmpty(newMeta))
            {
                return new JObject { ["success"] = false, ["error"] = "Failed to serialize metadata." };
            }

            // 8. Produce the new file bytes.
            // For WEBP without stealth metadata, rewrite only the EXIF chunk at the container
            // level: the compressed bitstream is left byte-for-byte intact, so quality and the
            // lossy/lossless kind are preserved exactly (a Load + re-encode would degrade a
            // lossy webp). This also handles animated webp, since the frames are untouched.
            string stealth = session.User.Settings.FileFormat.StealthMetadata;
            bool stealthOff = string.IsNullOrEmpty(stealth) || stealth.Equals("false", StringComparison.OrdinalIgnoreCase);
            byte[] newBytes = null;
            if (ext == "webp" && stealthOff)
            {
                newBytes = WebpExifRewriter.RewriteUserComment(bytes, newMeta);
            }
            if (newBytes is null)
            {
                // Re-encode path: PNG/JPG always; WEBP only when stealth metadata is enabled
                // (it must be re-embedded into the pixels) or the container rewrite didn't
                // apply. ConvertTo no-ops on animation types, so re-wrap a single WEBP frame
                // as a still PNG first; a true multi-frame animation can't be re-encoded here.
                ImageFile source = img;
                if (img.Type.MetaType != MediaMetaType.Image)
                {
                    if (img.ToIS.Frames.Count > 1)
                    {
                        return new JObject { ["success"] = false, ["error"] = "Editing the prompt is not supported for animated images." };
                    }
                    source = new Image(ImageFile.ISImgToPngBytes(img.ToIS), MediaType.ImagePng);
                }
                int quality = Math.Clamp(session.User.Settings.FileFormat.ImageQuality, 1, 100);
                int dpi = session.User.Settings.FileFormat.DPI;
                newBytes = source.ConvertTo(format, newMeta, dpi, quality, stealth).RawData;
            }

            // 9. Write the new bytes in place (same path / extension).
            File.WriteAllBytes(path, newBytes);

            // 10. Sidecar '.swarm.json'. Write it when the user opts in, when one already
            // exists (refresh so it never goes stale), or when the format's embedded metadata
            // isn't re-readable by OutputMetadataTracker (e.g. webp) — otherwise the edit would
            // vanish from the gallery once the cache is invalidated below, since the tracker
            // only re-reads embedded metadata for png/jpg and would find no source.
            string noExt = path.Substring(0, path.Length - (ext.Length + 1));
            string sidecar = noExt + ".swarm.json";
            if (session.User.Settings.FileFormat.SaveTextFileMetadata
                || File.Exists(sidecar)
                || !OutputMetadataTracker.ExtensionsWithMetadata.Contains(ext))
            {
                File.WriteAllBytes(sidecar, newMeta.EncodeUTF8());
            }

            // 11. Invalidate the metadata/preview caches (core passes the forward-slash form).
            string fwdPath = path.Replace('\\', '/');
            OutputMetadataTracker.RemoveMetadataFor(fwdPath);
            OutputMetadataTracker.GetOrCreatePreviewFor(fwdPath);

            // 12. Return the new indented metadata string for the frontend to re-render with.
            return new JObject { ["success"] = true, ["metadata"] = newMeta };
        }
        catch (Exception ex)
        {
            Logs.Error($"WhatTheDuck EditPrompt failed: {ex}");
            return new JObject { ["success"] = false, ["error"] = "Failed to edit prompt." };
        }
    }
}
