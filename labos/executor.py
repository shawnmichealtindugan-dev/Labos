"""Code execution engine (Python, C, C++, Java).

WARNING: this runs code in a temp folder with a timeout (plus CPU/file-size limits on
Linux/macOS), but it is NOT a real sandbox. For a production lab, run each job in a
Docker container (see README) -- swap the subprocess calls in `_run` for `docker run`.

Check which languages work on this computer:   python executor.py
"""
import glob, os, re, shutil, subprocess, sys, tempfile

IS_WIN = os.name == "nt"
EXE = ".exe" if IS_WIN else ""

# Folders to search when a tool is installed but its folder is not on PATH
_EXTRA = ([os.path.expandvars(p) for p in (
    r"%LOCALAPPDATA%\Microsoft\WinGet\Links",
    r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\BrechtSanders.WinLibs*\mingw64\bin",
    r"C:\msys64\ucrt64\bin", r"C:\msys64\mingw64\bin", r"C:\mingw64\bin", r"C:\MinGW\bin",
    r"C:\Program Files\Eclipse Adoptium\*\bin", r"C:\Program Files\Java\*\bin",
    r"C:\Program Files\Microsoft\jdk-*\bin", r"C:\Program Files\Zulu\*\bin",
    r"C:\Program Files\Amazon Corretto\*\bin", r"C:\Program Files\BellSoft\*\bin")]
    if IS_WIN else ["/usr/local/bin", "/opt/homebrew/bin", "/usr/lib/jvm/*/bin"])


def find_tool(name):
    """Full path of a program (gcc, javac, ...), or None if it is not installed."""
    found = shutil.which(name)
    if found:
        return found
    for pattern in _EXTRA:
        for folder in sorted(glob.glob(pattern), reverse=True):
            candidate = os.path.join(folder, name + EXE)
            if os.path.isfile(candidate):
                return candidate
    return None


def _hint(tool):
    if IS_WIN and tool in ("gcc", "g++"):
        return ("To fix: open PowerShell and run\n    winget install BrechtSanders.WinLibs.POSIX.UCRT\n"
                "then close and reopen VS Code.")
    if IS_WIN:
        return ("To fix: open PowerShell and run\n    winget install EclipseAdoptium.Temurin.21.JDK\n"
                "then close and reopen VS Code.")
    return "To fix: install it (Linux: sudo apt install build-essential default-jdk), then restart the server."


def _limits():  # Linux/macOS only: cap CPU seconds and output file size
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
        resource.setrlimit(resource.RLIMIT_FSIZE, (10_000_000, 10_000_000))
    except Exception:
        pass


def _env(bin_dir=None):
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    if bin_dir:   # lets compiled programs find the compiler's DLLs on Windows
        env["PATH"] = bin_dir + os.pathsep + env.get("PATH", "")
    return env


def _run(cmd, cwd, stdin="", timeout=8, bin_dir=None):
    try:
        p = subprocess.run(cmd, cwd=cwd, input=stdin, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env=_env(bin_dir), timeout=timeout,
                           preexec_fn=_limits if os.name == "posix" else None)
        return p.returncode, (p.stdout + p.stderr)[:20000]
    except subprocess.TimeoutExpired:
        return 124, f"[stopped: the program ran longer than {timeout} seconds]"
    except OSError as e:
        return 127, f"[could not start the program: {e}]"


def _write(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def _python(work, code, stdin):
    _write(os.path.join(work, "main.py"), code)
    rc, out = _run([sys.executable, "-X", "utf8", "main.py"], work, stdin)
    return dict(code=rc, output=out)


def _native(compiler, src):
    """C / C++: compile with gcc or g++, then run the program."""
    def go(work, code, stdin):
        tool = find_tool(compiler)
        if not tool:
            return dict(code=127, output=f"[{compiler} was not found on this computer]\n" + _hint(compiler))
        bin_dir = os.path.dirname(os.path.realpath(tool))
        _write(os.path.join(work, src), code)
        exe = os.path.join(work, "main" + EXE)
        cmd = [tool, src, "-o", exe] + (["-lm"] if compiler == "gcc" else [])
        rc, out = _run(cmd, work, timeout=30, bin_dir=bin_dir)
        if rc != 0:
            return dict(code=rc, output=out or "[compile failed]")
        rc, out = _run([exe], work, stdin, bin_dir=bin_dir)
        return dict(code=rc, output=out)
    return go


def _java_class(code):
    """Name of the class to run: the public class, else the class that holds main()."""
    m = re.search(r"public\s+(?:(?:final|abstract|strictfp)\s+)*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)", code)
    if m:
        return m.group(1)
    main = re.search(r"static\s+void\s+main\s*\(", code)
    if main:
        before = list(re.finditer(r"\b(?:class|interface|enum|record)\s+([A-Za-z_]\w*)", code[:main.start()]))
        if before:
            return before[-1].group(1)
    return "Main"


def _java(work, code, stdin):
    javac, java = find_tool("javac"), find_tool("java")
    for name, path in (("javac", javac), ("java", java)):
        if not path:
            return dict(code=127, output=f"[{name} was not found on this computer]\n" + _hint(name))
    name = _java_class(code)
    _write(os.path.join(work, name + ".java"), code)
    rc, out = _run([javac, "-encoding", "UTF-8", name + ".java"], work, timeout=30)
    if rc != 0:
        return dict(code=rc, output=out or "[compile failed]")
    rc, out = _run([java, "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8",
                    "-cp", work, name], work, stdin, timeout=10)
    return dict(code=rc, output=out)


LANGS = {"python": _python, "c": _native("gcc", "main.c"), "cpp": _native("g++", "main.cpp"), "java": _java}


def run_code(lang, code, stdin=""):
    if lang not in LANGS:
        return dict(code=1, output=f"Unsupported language: {lang}")
    work = tempfile.mkdtemp(prefix="labos_")
    try:
        return LANGS[lang](work, code, stdin)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":      # python executor.py  -> tests every language
    samples = {
        "python": 'print("ok")',
        "c": '#include <stdio.h>\nint main(void){ printf("ok\\n"); return 0; }',
        "cpp": '#include <iostream>\nint main(){ std::cout << "ok\\n"; }',
        "java": 'public class Main { public static void main(String[] a){ System.out.println("ok"); } }',
    }
    for lang, src in samples.items():
        r = run_code(lang, src)
        good = r["code"] == 0 and r["output"].strip() == "ok"
        print(f"{lang:7}", "OK" if good else "FAILED")
        if not good:
            print("   ", r["output"].strip().replace("\n", "\n    "))