const core = require('@actions/core');
const exec = require('@actions/exec');
const path = require('path');

async function run() {
    try {
        const workingDirectory = path.resolve(process.env.GITHUB_WORKSPACE, core.getInput('working-directory'))

        const [analyzeErrorCount, analyzeWarningCount, analyzeInfoCount] = await analyze(workingDirectory);
        const formatWarningCount = await format(workingDirectory);

        const issueCount = analyzeErrorCount + analyzeWarningCount + formatWarningCount + analyzeInfoCount;
        const failOnWarnings = core.getInput('fail-on-warnings') === 'true';
        const message = `${issueCount} issue${issueCount === 1 ? '' : 's'} found.`;

        if (analyzeErrorCount > 0 || (failOnWarnings && issueCount > 0)) {
            core.setFailed(message);
        } else {
            console.log(message);
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

async function analyze(workingDirectory) {
    let output = '';

    const options = {cwd: workingDirectory, silent: true, ignoreReturnCode: true};
    options.listeners = {
        stdout: (data) => {
            output += data.toString();
        },
        stderr: (data) => {
            output += data.toString();
        }
    };

    const args = ['--format', 'json'];

    args.push('.');

    await exec.exec('dart analyze', args, options);

    let errorCount = 0;
    let warningCount = 0;
    let noticeCount = 0;

    const cleanedOutput = output.trim().split(/\n/);
    const json = cleanedOutput.filter(s => s.startsWith('{')).map(s => s.trim())[0];

    if (!json) {
        return [errorCount, warningCount, noticeCount];
    }

    const result = JSON.parse(json);

    if (!Array.isArray(result.diagnostics)) {
        return [errorCount, warningCount, noticeCount];
    }

    for (const diagnostic of result.diagnostics) {
        const lint = diagnostic.code;
        const lintLowerCase = lint.toLowerCase();
        const file = diagnostic.location.file.replace(workingDirectory, '');
        const line = diagnostic.location.range.start.line;
        const column = diagnostic.location.range.start.column;
        const problemMessage = diagnostic.problemMessage;
        let url = diagnostic.documentation;
        if (!url) {
            url = lint === lintLowerCase
                ? `https://dart-lang.github.io/linter/lints/${lint}.html`
                : `https://dart.dev/tools/diagnostic-messages#${lintLowerCase}`;
        }
        const message = `file=${file},line=${line},col=${column}::${problemMessage} For more details, see ${url}`;

        if (diagnostic.severity === 'ERROR') {
            console.log(`::error ${message}`);
            errorCount++;
        } else if (diagnostic.severity === 'WARNING') {
            console.log(`::warning ${message}`);
            warningCount++;
        } else {
            console.log(`::notice ${message}`);
            noticeCount++;
        }
    }

    return [errorCount, warningCount, noticeCount];
}

async function format(workingDirectory) {
    let output = '';

    const options = {cwd: workingDirectory, silent: true, ignoreReturnCode: true};
    options.listeners = {
        stdout: (data) => {
            output += data.toString();
        },
        stderr: (data) => {
            output += data.toString();
        }
    };

    const args = ['format', '--output=none'];
    const lineLength = core.getInput('line-length');

    if (lineLength) {
        args.push('--line-length');
        args.push(lineLength);
    }

    args.push('.');

    await exec.exec('dart', args, options);

    let warningCount = 0;
    const lines = output.trim().split(/\r?\n/);

    for (const line of lines) {
        if (!line.endsWith('.dart')) continue;
        const file = line.substring(8); // Remove the "Changed " prefix

        console.log(`::warning file=${file}::Invalid format. For more details, see https://dart.dev/guides/language/effective-dart/style#formatting`);
        warningCount++;
    }

    return warningCount;
}

run();
