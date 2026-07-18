import { civitaiFolders } from "./civitaiFolders";
import { promptEdit } from "./promptEdit";
import { redo } from "./redo";
import { whatTheDuck } from "./settings";

redo.init();

document.addEventListener("DOMContentLoaded", () => {
    whatTheDuck.init();
    promptEdit.init();
    civitaiFolders.init();
});
