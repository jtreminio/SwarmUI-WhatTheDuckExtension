import { archFolders } from "./archFolders";
import { comfyWorkflowSave } from "./comfyWorkflowSave";
import { modelHashOverride } from "./modelHashOverride";
import { modelMultiSelect } from "./modelMultiSelect";
import { promptEdit } from "./promptEdit";
import { promptResize } from "./promptResize";
import { redo } from "./redo";
import { whatTheDuck } from "./settings";

redo.init();

document.addEventListener("DOMContentLoaded", () => {
    whatTheDuck.init();
    promptEdit.init();
    promptResize.init();
    archFolders.init();
    comfyWorkflowSave.init();
    modelMultiSelect.init();
    modelHashOverride.init();
});
