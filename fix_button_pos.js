const fs = require('fs');
const path = 'style.css';

try {
    let content = fs.readFileSync(path, 'utf8');

    // Inject or update hamburger-btn z-index
    if (content.includes('.hamburger-btn')) {
        content = content.replace('.hamburger-btn {', '.hamburger-btn {\n    z-index: 900 !important;');
    }

    // Inject or update sidebar z-index
    if (content.includes('.sidebar')) {
        content = content.replace('.sidebar {', '.sidebar {\n    z-index: 1000 !important;');
    }

    fs.writeFileSync(path, content, 'utf8');
    console.log("style.css updated successfully via Node.js!");
} catch (err) {
    console.error("Error updating style.css:", err);
}
