using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Text;
using SixLabors.ImageSharp.Metadata.Profiles.Exif;

namespace WhatTheDuck;

/// <summary>
/// Container-level WebP metadata editing. Rewrites the EXIF chunk of a RIFF/WebP file in
/// place, leaving the compressed VP8/VP8L bitstream byte-for-byte intact. This changes the
/// embedded metadata (e.g. the prompt) without decoding/re-encoding the pixels, so image
/// quality — and the lossy/lossless kind of the file — is preserved exactly, unlike a
/// Load + SaveAsWebp round-trip. Works for both still and animated WebP (frames untouched).
/// </summary>
public static class WebpExifRewriter
{
    // Optional EXIF header ("Exif\0\0") that some writers prepend before the TIFF data.
    private static readonly byte[] ExifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

    /// <summary>
    /// Returns a copy of <paramref name="webp"/> with the EXIF UserComment replaced by
    /// <paramref name="newUserComment"/>, preserving every other chunk (and the image data)
    /// byte-for-byte. Returns null if the bytes aren't a RIFF/WebP that already carries a
    /// parseable EXIF chunk — callers should then fall back to a full re-encode.
    /// </summary>
    public static byte[] RewriteUserComment(byte[] webp, string newUserComment)
    {
        if (webp is null || webp.Length < 12
            || Encoding.ASCII.GetString(webp, 0, 4) != "RIFF"
            || Encoding.ASCII.GetString(webp, 8, 4) != "WEBP")
        {
            return null;
        }
        // Walk the top-level RIFF chunks. Each is: 4-byte FourCC, 4-byte little-endian size,
        // payload, then a single pad byte if the size is odd.
        List<(string Id, int Start, int Len)> chunks = [];
        int exifStart = -1, exifLen = -1;
        int pos = 12;
        while (pos + 8 <= webp.Length)
        {
            string fourcc = Encoding.ASCII.GetString(webp, pos, 4);
            int size = BinaryPrimitives.ReadInt32LittleEndian(webp.AsSpan(pos + 4, 4));
            int payloadStart = pos + 8;
            if (size < 0 || payloadStart + (long)size > webp.Length)
            {
                break; // malformed / truncated
            }
            chunks.Add((fourcc, payloadStart, size));
            if (fourcc == "EXIF")
            {
                exifStart = payloadStart;
                exifLen = size;
            }
            pos = payloadStart + size + (size & 1);
        }
        if (exifStart < 0)
        {
            return null; // no EXIF chunk to rewrite
        }
        byte[] origExif = webp.AsSpan(exifStart, exifLen).ToArray();
        ExifProfile profile;
        try
        {
            profile = new ExifProfile(origExif);
        }
        catch
        {
            return null;
        }
        profile.SetValue(ExifTag.UserComment, newUserComment);
        byte[] newExif = profile.ToByteArray();
        if (newExif is null)
        {
            return null;
        }
        // Match the original chunk's framing regarding the optional "Exif\0\0" header.
        bool origHadHeader = StartsWith(origExif, ExifHeader);
        bool newHasHeader = StartsWith(newExif, ExifHeader);
        if (origHadHeader && !newHasHeader)
        {
            byte[] prefixed = new byte[ExifHeader.Length + newExif.Length];
            ExifHeader.CopyTo(prefixed, 0);
            newExif.CopyTo(prefixed, ExifHeader.Length);
            newExif = prefixed;
        }
        else if (!origHadHeader && newHasHeader)
        {
            newExif = newExif.AsSpan(ExifHeader.Length).ToArray();
        }
        // Rebuild the RIFF, swapping only the EXIF chunk and recomputing sizes/padding.
        using MemoryStream ms = new();
        ms.Write(webp, 0, 12); // 'RIFF' + (size placeholder, fixed below) + 'WEBP'
        Span<byte> sizeBuf = stackalloc byte[4];
        foreach ((string id, int start, int len) in chunks)
        {
            byte[] payload = id == "EXIF" ? newExif : webp.AsSpan(start, len).ToArray();
            ms.Write(Encoding.ASCII.GetBytes(id));
            BinaryPrimitives.WriteInt32LittleEndian(sizeBuf, payload.Length);
            ms.Write(sizeBuf);
            ms.Write(payload);
            if ((payload.Length & 1) == 1)
            {
                ms.WriteByte(0); // pad to even
            }
        }
        byte[] result = ms.ToArray();
        BinaryPrimitives.WriteInt32LittleEndian(result.AsSpan(4, 4), result.Length - 8);
        return result;
    }

    private static bool StartsWith(byte[] data, byte[] prefix)
    {
        if (data.Length < prefix.Length)
        {
            return false;
        }
        for (int i = 0; i < prefix.Length; i++)
        {
            if (data[i] != prefix[i])
            {
                return false;
            }
        }
        return true;
    }
}
