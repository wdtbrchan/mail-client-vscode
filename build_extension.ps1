
Write-Host "Starting build process..."

# Install dependencies
Write-Host "Installing dependencies..."
npm install

# Compile the extension
Write-Host "Compiling extension..."
npm run compile

# Package the extension
Write-Host "Packaging VSIX..."
npx vsce package

Write-Host "Build complete!"
