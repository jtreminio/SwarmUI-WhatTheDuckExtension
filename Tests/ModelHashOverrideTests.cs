using Newtonsoft.Json.Linq;
using SwarmUI.Core;
using SwarmUI.Text2Image;
using WhatTheDuck;
using Xunit;

[CollectionDefinition("Model hash overrides", DisableParallelization = true)]
public class ModelHashOverrideCollection { }

[Collection("Model hash overrides")]
public class ModelHashOverrideTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), $"wtd-hashes-{Guid.NewGuid():N}");
    private readonly bool includeHashes = Program.ServerSettings.Metadata.ImageMetadataIncludeModelHash;
    private readonly Dictionary<string, T2IModelHandler> handlers = Program.T2IModelSets;
    private string FilePath => Path.Combine(root, "ModelHashOverrides.json");

    public ModelHashOverrideTests()
    {
        Program.ServerSettings.Metadata.ImageMetadataIncludeModelHash = true;
        Program.T2IModelSets = new();
    }

    private T2IModel Model(string subtype, string name, string hash = "0x1234")
    {
        if (!Program.T2IModelSets.TryGetValue(subtype, out var handler))
        {
            handler = new T2IModelHandler { ModelType = subtype };
            Program.T2IModelSets[subtype] = handler;
        }
        var model = new T2IModel(handler, root, Path.Combine(root, name), name)
        {
            Metadata = new() { Hash = hash, Title = "Preserved title" }
        };
        handler.Models[name] = model;
        return model;
    }

    [Fact]
    public void PersistsAllTypesAndPathsAndClearsOnlySelectedOverride()
    {
        var store = new ModelHashOverrideStore(FilePath);
        store.Save("Stable-Diffusion", "folder\\same.gguf", " 0xABCDEF ");
        store.Save("LoRA", "folder/same.gguf", "1234567890");
        var reloaded = new ModelHashOverrideStore(FilePath);
        Assert.Equal("0xABCDEF", reloaded.Get("Stable-Diffusion", "folder/same.gguf"));
        Assert.Equal("1234567890", reloaded.Get("LoRA", "folder/same.gguf"));
        reloaded.Save("Stable-Diffusion", "folder/same.gguf", "");
        Assert.Equal("", new ModelHashOverrideStore(FilePath).Get("Stable-Diffusion", "folder/same.gguf"));
        Assert.Equal("1234567890", new ModelHashOverrideStore(FilePath).Get("LoRA", "folder/same.gguf"));
        Assert.Single(Directory.GetFiles(root));
    }

    [Theory]
    [InlineData("not a hash")]
    [InlineData("0x")]
    [InlineData("abcdef\nxyz")]
    public void InvalidHashDoesNotOverwriteSavedValues(string hash)
    {
        var store = new ModelHashOverrideStore(FilePath);
        store.Save("LoRA", "model", "abc");
        string before = File.ReadAllText(FilePath);
        Assert.Throws<ArgumentException>(() => store.Save("LoRA", "model", hash));
        Assert.Equal(before, File.ReadAllText(FilePath));
    }

    [Fact]
    public void CorruptFileIsNeverSilentlyReplaced()
    {
        Directory.CreateDirectory(root);
        File.WriteAllText(FilePath, "{broken");
        var store = new ModelHashOverrideStore(FilePath);
        Assert.ThrowsAny<Exception>(() => store.Save("LoRA", "model", "abc"));
        Assert.Equal("{broken", File.ReadAllText(FilePath));
    }

    [Fact]
    public void OutputMetadataUsesOverridesWithoutChangingSharedModelsOrModelFiles()
    {
        var store = new ModelHashOverrideStore(FilePath);
        var checkpoint = Model("Stable-Diffusion", "folder/model.gguf", null);
        var lora = Model("LoRA", "folder/model.gguf");
        var embedding = Model("Embedding", "embed.safetensors");
        var vae = Model("VAE", "vae.safetensors");
        store.Save("Stable-Diffusion", checkpoint.Name, "AABBCC");
        store.Save("LoRA", lora.Name, "112233");
        store.Save("Embedding", embedding.Name, "445566");
        var source = new T2IParamInput(null) { NoUnusedParams = true };
        source.InternalSet.ValuesInput["model"] = checkpoint;
        source.InternalSet.ValuesInput["vae"] = vae;
        source.InternalSet.ValuesInput["loras"] = new List<string> { lora.Name };
        source.ExtraMeta["used_embeddings"] = new List<string> { embedding.Name };
        var output = source.Clone();
        ModelHashOverrides.Apply(output, store);
        ModelHashOverrides.Apply(output, store); // Repeated hooks must preserve name-list serialization.
        JObject metadata = output.GenFullMetadataObject();
        var models = (JArray)metadata["sui_models"]!;
        Assert.Contains(models, m => m.Value<string>("param") == "model" && m.Value<string>("hash") == "AABBCC");
        Assert.Contains(models, m => m.Value<string>("param") == "loras" && m.Value<string>("hash") == "112233");
        Assert.Contains(models, m => m.Value<string>("param") == "used_embeddings" && m.Value<string>("hash") == "445566");
        Assert.Contains(models, m => m.Value<string>("param") == "vae" && m.Value<string>("hash") == "0x1234");
        Assert.Equal(lora.Name, metadata["sui_image_params"]!["loras"]![0]!.Value<string>());
        Assert.Equal(embedding.Name, metadata["sui_extra_data"]!["used_embeddings"]![0]!.Value<string>());
        Assert.Null(checkpoint.Metadata.Hash);
        Assert.Equal("0x1234", lora.Metadata.Hash);
        Assert.Same(checkpoint, source.InternalSet.ValuesInput["model"]);
        Assert.IsType<List<string>>(source.InternalSet.ValuesInput["loras"]);
        Assert.Equal("Preserved title", ((T2IModel)output.InternalSet.ValuesInput["model"]).Metadata.Title);
        Assert.Single(Directory.GetFiles(root, "*", SearchOption.AllDirectories));
        store.Save("Stable-Diffusion", checkpoint.Name, "");
        var next = source.Clone();
        ModelHashOverrides.Apply(next, store);
        Assert.Same(checkpoint, next.InternalSet.ValuesInput["model"]);
    }

    [Fact]
    public void CopiesModelListsWithoutMutatingOriginalEntries()
    {
        var store = new ModelHashOverrideStore(FilePath);
        var first = Model("LoRA", "first.safetensors");
        var second = Model("LoRA", "second.safetensors");
        store.Save("LoRA", first.Name, "abc");
        var original = new List<T2IModel> { first, second };
        var input = new T2IParamInput(null);
        input.InternalSet.ValuesInput["models"] = original;
        ModelHashOverrides.Apply(input, store);
        var copied = Assert.IsType<List<T2IModel>>(input.InternalSet.ValuesInput["models"]);
        Assert.NotSame(original, copied);
        Assert.Equal("abc", copied[0].Metadata.Hash);
        Assert.Equal("0x1234", original[0].Metadata.Hash);
        Assert.Same(second, copied[1]);
    }

    [Fact]
    public void ConcurrentSavesRetainEveryOverride()
    {
        var store = new ModelHashOverrideStore(FilePath);
        Parallel.For(0, 20, i => store.Save("LoRA", $"model-{i}", "abc"));
        var reloaded = new ModelHashOverrideStore(FilePath);
        for (int i = 0; i < 20; i++) Assert.Equal("abc", reloaded.Get("LoRA", $"model-{i}"));
        Assert.Single(Directory.GetFiles(root));
    }

    [Fact]
    public void DisabledHashSettingLeavesInputUntouched()
    {
        var model = Model("Stable-Diffusion", "model.gguf");
        var store = new ModelHashOverrideStore(FilePath);
        store.Save("Stable-Diffusion", model.Name, "abc");
        Program.ServerSettings.Metadata.ImageMetadataIncludeModelHash = false;
        var input = new T2IParamInput(null) { NoUnusedParams = true };
        input.InternalSet.ValuesInput["model"] = model;
        ModelHashOverrides.Apply(input, store);
        Assert.Same(model, input.InternalSet.ValuesInput["model"]);
        Assert.Null(input.GenFullMetadataObject()["sui_models"]);
    }

    public void Dispose()
    {
        foreach (var handler in Program.T2IModelSets.Values) handler.Shutdown();
        Program.T2IModelSets = handlers;
        Program.ServerSettings.Metadata.ImageMetadataIncludeModelHash = includeHashes;
        if (Directory.Exists(root)) Directory.Delete(root, true);
    }
}
