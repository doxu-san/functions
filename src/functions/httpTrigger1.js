const { app } = require('@azure/functions');

app.http('httpTrigger1', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log(`Http function processed request for url "${request.url}"`);

        const name = request.query.get('name') || await request.text() || 'world';

        return { body: `Hello, ${name}!` };
    }
});

module.exports = async function (context, req) {
    context.log('C code compilation request received.');

    if (req.body && req.body.code) {
        const code = req.body.code;

        // C コードを一時ファイルに書き込む
        const cFilePath = path.join(context.executionContext.functionDirectory, 'temp.c');
        fs.writeFileSync(cFilePath, code);

        // コンパイル処理（Emscripten を使用）
        exec(`emcc ${cFilePath} -o temp.html`, async (error, stdout, stderr) => {
            if (error) {
                context.res = {
                    status: 500,
                    body: "Compilation failed: " + stderr
                };
            } else {
                // 生成されたファイルを読み込む
                const htmlFilePath = path.join(context.executionContext.functionDirectory, 'temp.html');
                const jsFilePath = path.join(context.executionContext.functionDirectory, 'temp.js');
                const wasmFilePath = path.join(context.executionContext.functionDirectory, 'temp.wasm');

                // Azure Blob Service に接続
                const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AzureWebJobsStorage);
                const containerName = 'compiled-code';

                // Blob コンテナーを作成
                const containerClient = blobServiceClient.getContainerClient(containerName);
                await containerClient.createIfNotExists();

                // Blob にファイルをアップロード
                await uploadBlob(containerClient, 'temp.html', htmlFilePath);
                await uploadBlob(containerClient, 'temp.js', jsFilePath);
                await uploadBlob(containerClient, 'temp.wasm', wasmFilePath);

                /*// HTML 生成処理
                const html = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Compiled C Code</title>
                        <script src="temp.js"></script>
                    </head>
                    <body>
                        <h1>Compiled C Code</h1>
                        <!-- 生成された HTML を読み込む -->
                        <iframe src="temp.html"></iframe>
                    </body>
                    </html>
                `;*/

                context.res = {
                    status: 200,
                    body: html
                };
            }
        });
    } else {
        context.res = {
            status: 400,
            body: "Please provide C code to compile."
        };
    }
};

// Blob にファイルをアップロードする関数
async function uploadBlob(containerClient, fileName, filePath) {
    const blobClient = containerClient.getBlockBlobClient(fileName);
    const stream = fs.createReadStream(filePath);
    await blobClient.uploadStream(stream, undefined, undefined, { blobHTTPHeaders: { blobContentType: 'text/html' } });
}