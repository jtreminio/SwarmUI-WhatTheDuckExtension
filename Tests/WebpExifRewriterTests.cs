using System.Buffers.Binary;
using ImageMagick;
using SwarmUI.Utils;
using WhatTheDuck;
using Xunit;

public class WebpExifRewriterTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void RewritesUnicodeCommentWhilePreservingOtherExifTagsAndImageChunk(bool hasExifHeader)
    {
        const int exifChunkOffset = 24;
        ExifProfile originalProfile = new();
        originalProfile.SetValue(ExifTag.Model, "Original camera");
        originalProfile.SetValue(ExifTag.UserComment, MetadataHelper.EncodeExifUserComment("Old prompt"));
        byte[] originalExif = originalProfile.ToByteArray();
        ReadOnlySpan<byte> exifPayload = hasExifHeader ? originalExif : originalExif.AsSpan(6);

        using MemoryStream stream = new();
        using BinaryWriter writer = new(stream);
        writer.Write("RIFF"u8);
        writer.Write(exifChunkOffset + exifPayload.Length + (exifPayload.Length & 1));
        writer.Write("WEBPVP8L"u8);
        writer.Write(3);
        writer.Write(new byte[] { 1, 2, 3, 0 }); // Stand-in for a compressed image chunk with padding.
        writer.Write("EXIF"u8);
        writer.Write(exifPayload.Length);
        writer.Write(exifPayload);
        if ((exifPayload.Length & 1) != 0)
        {
            writer.Write((byte)0);
        }

        byte[] original = stream.ToArray();
        const string newPrompt = "東京 🦆 café";
        byte[] rewritten = WebpExifRewriter.RewriteUserComment(original, newPrompt);

        Assert.NotNull(rewritten);
        Assert.Equal(rewritten.Length - 8, BinaryPrimitives.ReadInt32LittleEndian(rewritten.AsSpan(4)));
        Assert.Equal(original[8..exifChunkOffset], rewritten[8..exifChunkOffset]);
        int exifSize = BinaryPrimitives.ReadInt32LittleEndian(rewritten.AsSpan(exifChunkOffset + 4));
        ReadOnlySpan<byte> rewrittenExif = rewritten.AsSpan(exifChunkOffset + 8, exifSize);
        Assert.Equal(hasExifHeader, rewrittenExif.StartsWith("Exif\0\0"u8));
        byte[] profileBytes = hasExifHeader ? rewrittenExif.ToArray() : [.. "Exif\0\0"u8, .. rewrittenExif];
        ExifProfile profile = new(profileBytes);
        Assert.Equal("Original camera", profile.GetValue(ExifTag.Model)?.Value);
        Assert.Equal(newPrompt, MetadataHelper.DecodeExifUserComment(profile.GetValue(ExifTag.UserComment)!.Value, profileBytes));
    }
}
