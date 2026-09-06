using WhatTheDuck;
using Xunit;

public class ModelDownloadAuthTests
{
    [Theory]
    [InlineData("https://civitai.com/api/download/models/123", "https://civitai.red/api/download/models/123?token=test-key")]
    [InlineData("https://civitai.red/api/download/models/123?type=Model", "https://civitai.red/api/download/models/123?type=Model&token=test-key")]
    [InlineData("https://civitai.red/api/download/models/123?token=explicit", "https://civitai.red/api/download/models/123?token=explicit")]
    [InlineData("https://civitai.red/api/download/models/123?type=Model&token=explicit", "https://civitai.red/api/download/models/123?type=Model&token=explicit")]
    public void CivitaiAddsStoredKeyWithoutReplacingExplicitToken(string url, string expected)
    {
        var prepared = ModelDownloadAuth.Prepare(url, provider =>
        {
            Assert.Equal("civitai_api", provider);
            return "test-key";
        });
        Assert.Equal(expected, prepared.Url);
        Assert.Empty(prepared.Headers);
    }

    [Fact]
    public void HuggingFaceKeyGoesInAuthorizationHeader()
    {
        string url = "https://huggingface.co/org/repo/resolve/main/model.safetensors";
        var prepared = ModelDownloadAuth.Prepare(url, provider =>
        {
            Assert.Equal("huggingface_api", provider);
            return "hf-test-key";
        });
        Assert.Equal(url, prepared.Url);
        Assert.Equal("Bearer hf-test-key", prepared.Headers["Authorization"]);
    }

    [Theory]
    [InlineData("https://example.com/model.safetensors")]
    [InlineData("https://huggingface.co.example.com/model.safetensors")]
    [InlineData("https://civitai.red.example.com/model.safetensors")]
    public void OtherHostsNeverReceiveStoredCredentials(string url)
    {
        var prepared = ModelDownloadAuth.Prepare(url, _ => throw new InvalidOperationException("Must not read a key for another host"));
        Assert.Equal(url, prepared.Url);
        Assert.Empty(prepared.Headers);
    }

    [Theory]
    [InlineData("https://civitai.red/api/download/models/123")]
    [InlineData("https://huggingface.co/org/model.safetensors")]
    public void MissingKeyLeavesRequestUnauthenticated(string url)
    {
        var prepared = ModelDownloadAuth.Prepare(url, _ => null);
        Assert.Equal(url, prepared.Url);
        Assert.Empty(prepared.Headers);
    }
}
