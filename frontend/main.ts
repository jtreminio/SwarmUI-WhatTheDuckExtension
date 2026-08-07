import { archFolders } from "./archFolders";
import { comfyWorkflowSave } from "./comfyWorkflowSave";
import { promptEdit } from "./promptEdit";
import { redo } from "./redo";
import { whatTheDuck } from "./settings";

redo.init();

document.addEventListener("DOMContentLoaded", () => {
    whatTheDuck.init();
    promptEdit.init();
    archFolders.init();
    comfyWorkflowSave.init();
});
