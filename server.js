import app from "./app.js";
import "./worker/trashCleanup.js";
import "./worker/warningCronJob.js";
import "./worker/fileDeletionCron.js";

const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
