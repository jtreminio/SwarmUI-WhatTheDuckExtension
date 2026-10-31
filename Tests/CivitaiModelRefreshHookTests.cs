using SwarmUI.Core;
using SwarmUI.Text2Image;
using System.Text;
using WhatTheDuck;
using Xunit;

[CollectionDefinition("Civitai refresh hooks", DisableParallelization = true)]
public class CivitaiRefreshHookCollection { }

[Collection("Civitai refresh hooks")]
public class CivitaiModelRefreshHookTests
{
    [Fact]
    public async Task ResaveAfterRefreshQueuesFinalFingerprintAndPreservesSwarmHash()
    {
        string root = Path.Combine(Path.GetTempPath(), "wtd-resave-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        string path = Path.Combine(root, "model.safetensors");
        byte[] header = Encoding.UTF8.GetBytes("{\"__metadata__\":{}}");
        using (FileStream stream = File.Create(path))
        {
            stream.Write(BitConverter.GetBytes((long)header.Length));
            stream.Write(header);
            stream.Write(new byte[16]);
        }
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddMinutes(-1));
        T2IModelHandler handler = new() { ModelType = "LoRA" };
        T2IModel model = new(handler, root, path, "model.safetensors")
        {
            Description = "From <a href=\"https://civitai.com/models/1?modelVersionId=10\">source</a>",
            Metadata = new()
            {
                Hash = "0x" + new string('a', 64),
                ModelFileVersion = new DateTimeOffset(File.GetLastWriteTimeUtc(path)).ToUnixTimeMilliseconds()
            }
        };
        bool originalJson = Program.ServerSettings.Metadata.EditMetadataWriteJSON;
        bool originalClear = Program.ServerSettings.Paths.ClearStrayModelData;
        CivitaiRefreshSignal signal = new();
        int callbacks = 0;
        CivitaiLocalFile Local() => new("LoRA", model.Name, path, model.Metadata.Hash, model.Description, CivitaiModelRefreshHook.CachedFileVersion(model));
        try
        {
            Program.ServerSettings.Metadata.EditMetadataWriteJSON = false;
            Program.ServerSettings.Paths.ClearStrayModelData = false;
            CivitaiModelRefreshHook.Register(() => { callbacks++; signal.Request(); });
            CivitaiIdentityIndex index = new(Path.Combine(root, "index.json"));
            handler.Refresh();
            await signal.ReconcileAsync(() => index.ReconcileAsync([Local()]));
            string before = Assert.Single(index.Snapshot()).FileStamp;

            model.ResaveModel(); // Core downloader calls this only after handler.Refresh returns.
            Assert.Equal(2, callbacks);
            Assert.False(CivitaiIdentityMetadata.IsCurrent(Assert.Single(index.Snapshot())));
            Assert.Equal(new DateTimeOffset(File.GetLastWriteTimeUtc(path)).ToUnixTimeMilliseconds(), CivitaiModelRefreshHook.CachedFileVersion(model));
            await signal.ReconcileAsync(() => index.ReconcileAsync([Local()]));
            CivitaiIdentity current = Assert.Single(index.Snapshot());
            Assert.NotEqual(before, current.FileStamp);
            Assert.True(CivitaiIdentityMetadata.IsCurrent(current));
            Assert.Equal(new string('A', 64), current.Hashes["TensorSHA256"]);
        }
        finally
        {
            CivitaiModelRefreshHook.Unregister();
            Program.ModelRefreshEvent -= handler.Refresh;
            Program.ServerSettings.Metadata.EditMetadataWriteJSON = originalJson;
            Program.ServerSettings.Paths.ClearStrayModelData = originalClear;
            Directory.Delete(root, true);
        }
    }

    [Theory]
    [InlineData("Stable-Diffusion", false, 1)]
    [InlineData("LoRA", false, 1)]
    [InlineData("VAE", false, 0)]
    [InlineData("LoRA", true, 0)]
    public void DirectHandlerRefreshNotifiesAfterInventoryReplacement(string subtype, bool stopped, int expected)
    {
        T2IModelHandler handler = new() { ModelType = subtype, IsShutdown = stopped };
        handler.Models["old"] = new(handler, "/unused", "/unused/old.safetensors", "old");
        int calls = 0;
        try
        {
            CivitaiModelRefreshHook.Register(() =>
            {
                Assert.Empty(handler.Models);
                calls++;
            });
            handler.Refresh(); // Same direct call used by SwarmUI's downloader, with no global refresh event.
            Assert.Equal(expected, calls);
            CivitaiModelRefreshHook.Unregister();
            handler.Refresh();
            Assert.Equal(expected, calls);
        }
        finally
        {
            CivitaiModelRefreshHook.Unregister();
            Program.ModelRefreshEvent -= handler.Refresh;
        }
    }

    [Fact]
    public void RepeatedRegistrationDoesNotDuplicateRefreshCallbacks()
    {
        T2IModelHandler handler = new() { ModelType = "LoRA" };
        int calls = 0;
        Action callback = () => calls++;
        try
        {
            CivitaiModelRefreshHook.Register(callback);
            CivitaiModelRefreshHook.Register(callback);
            handler.Refresh();
            Assert.Equal(1, calls);
        }
        finally
        {
            CivitaiModelRefreshHook.Unregister();
            Program.ModelRefreshEvent -= handler.Refresh;
        }
    }
}
