using SwarmUI.Text2Image;

namespace WhatTheDuck;

public static class PromptVariableTrimming
{
    private static bool _registered;

    public static void Register()
    {
        if (_registered)
        {
            return;
        }
        Func<string, T2IPromptHandling.PromptTagContext, string> original = T2IPromptHandling.PromptTagProcessors["setvar"];

        T2IPromptHandling.PromptTagProcessors["setvar"] = (data, context) =>
        {
            string result = original(data, context);
            if (!WhatTheDuckExtension.TrimPromptVariables || result is null)
            {
                return result;
            }

            string name = GetVariableName(context.PreData);
            if (name is null || !context.Variables.TryGetValue(name, out string storedValue))
            {
                return result;
            }

            string trimmedValue = storedValue.Trim();
            context.Variables[name] = trimmedValue;
            return result == storedValue ? trimmedValue : result;
        };
        _registered = true;
    }

    private static string GetVariableName(string preData)
    {
        if (preData is null)
        {
            return null;
        }
        int comma = preData.IndexOf(',');
        return comma < 0 ? preData : preData[..comma];
    }
}
