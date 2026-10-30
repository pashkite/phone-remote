package com.galaxyremote.app.display

/** The only commands available to the shell service; no caller-supplied shell text or display ID. */
internal enum class PanelCommand(val arguments: List<String>) {
    HELP(listOf("/system/bin/cmd", "display", "help")),
    STATE(listOf("/system/bin/dumpsys", "display")),
    OFF(listOf("/system/bin/cmd", "display", "power-off", "0")),
    RESET(listOf("/system/bin/cmd", "display", "power-reset", "0")),
    ON(listOf("/system/bin/cmd", "display", "power-on", "0"));
    val nameInHelp: String get() = arguments[2]
}

internal data class PanelCommandResult(
    val exitCode: Int?, val output: String,
    val timedOut: Boolean = false, val truncated: Boolean = false, val failure: String? = null,
) {
    val controlSucceeded: Boolean get() = exitCode == 0 && !timedOut && !truncated && failure == null &&
        !Regex("(?i)unknown command|error:|exception|permission denial|permission denied").containsMatchIn(output)
    fun displaySummary(): String = when {
        truncated && copy(truncated = false).controlSucceeded -> "일부 조회 완료 (출력 길이 제한 · 명령 지원 검사와 별도)"
        controlSucceeded -> "완료"
        else -> "실패 (명령 지원 검사와 별도)"
    }
    fun diagnostics(label: String) = "$label\nexitCode=$exitCode; timedOut=$timedOut; truncated=$truncated; failure=${failure ?: "none"}\n$output"
}

internal data class PanelSupport(val known: Boolean, val off: Boolean, val reset: Boolean, val on: Boolean) {
    val recovery: PanelCommand? get() = when { !known -> null; reset -> PanelCommand.RESET; on -> PanelCommand.ON; else -> null }
    val canOff: Boolean get() = known && off && recovery != null
    fun summary(): String {
        if (!known) return "명령 지원 여부를 확인하지 못했습니다. OFF 시험은 차단됩니다."
        fun label(value: Boolean) = if (value) "지원" else "미지원"
        return "power-off: ${label(off)} · power-reset: ${label(reset)} · power-on(구형): ${label(on)}\n" +
            "복구 후보: ${recovery?.nameInHelp ?: "없음"}\n" +
            if (canOff) "복구 사전 검사와 별도 외부 복구 검증이 필요합니다." else "필요한 명령이 없어 이 펌웨어의 OFF 시험은 지원하지 않습니다."
    }
    companion object {
        fun parse(result: PanelCommandResult): PanelSupport {
            // ShellCommand help may return -1 after printing a complete, normal command list.
            // Parse declaration lines throughout the bounded output, not substrings/prose/examples.
            val entries = Regex("(?m)^([\\t ]*)(help|power-off|power-reset|power-on|set-brightness|get-brightness|get-displays|set-user-preferred-display-mode|get-user-preferred-display-mode)(?=\\s|$)")
                .findAll(result.output).toList()
            val commandIndent = entries.minOfOrNull { it.groupValues[1].replace("\t", "    ").length }
            val declarations = entries.filter { it.groupValues[1].replace("\t", "    ").length == commandIndent }
                .map { it.groupValues[2] }.toSet()
            val header = Regex("(?im)^\\s*Display manager commands\\s*:").containsMatchIn(result.output)
            val hardError = Regex("(?im)^\\s*(?:permission denial|permission denied|securityexception|error:|exception[^a-z]|java\\.[^\\n]*exception)").containsMatchIn(result.output)
            val known = header && declarations.isNotEmpty() && !hardError && !result.timedOut && !result.truncated && result.failure == null
            return PanelSupport(known, known && "power-off" in declarations, known && "power-reset" in declarations, known && "power-on" in declarations)
        }
    }
}

internal data class PanelInspection(val help: PanelCommandResult, val display: PanelCommandResult, val support: PanelSupport) {
    fun diagnostics() = help.diagnostics("cmd display help") + "\n\n" + display.diagnostics("dumpsys display")
}

internal data class PanelReport(val summary: String, val diagnostics: String, val success: Boolean, val trialReady: Boolean = false)

/** Pure state machine: inspection never executes a power command; control exit status stays strict. */
internal class PanelPreflight(private val execute: (PanelCommand) -> PanelCommandResult, private val lease: PanelLease) {
    var inspection: PanelInspection? = null
        private set
    val recovery: PanelCommand? get() = inspection?.support?.recovery
    private fun query(command: PanelCommand): PanelCommandResult = try { execute(command) }
        catch (error: Exception) { PanelCommandResult(null, "", failure = error.javaClass.simpleName + ": " + error.message) }

    fun inspect(): PanelInspection {
        lease.checked(false)
        inspection = null // a failed/unknown new query cannot reuse a previous successful preflight
        val help = query(PanelCommand.HELP)
        val display = query(PanelCommand.STATE) // independent, including when help fails or is unsupported
        return PanelInspection(help, display, PanelSupport.parse(help)).also { inspection = it }
    }

    fun checkRecovery(): PanelReport {
        val current = inspect()
        val candidate = current.support.recovery
        if (candidate == null) return PanelReport(
            if (current.support.known) "복구 명령이 지원되지 않습니다. OFF 시험은 차단됩니다." else "명령 지원 여부를 확인하지 못했습니다. OFF 시험은 차단됩니다.",
            current.diagnostics(), false,
        )
        val result = query(candidate)
        val details = current.diagnostics() + "\n\n" + result.diagnostics("recovery preflight: ${candidate.nameInHelp} 0")
        if (!result.controlSucceeded) return PanelReport("복구 명령 사전 검사에 실패했습니다. 전체 진단을 확인하세요.", details, false)
        lease.checked(current.support.canOff)
        return PanelReport(
            "${candidate.nameInHelp} 명령이 화면 ON 사전 검사에서 수락됐습니다.\n" +
                (if (current.support.canOff) "OFF 이후 실제 복구는 미검증입니다. 외부 복구 경로를 별도로 확인하세요." else "power-off 미지원으로 OFF 시험은 차단됩니다. 실제 복구는 미검증입니다."),
            details, true, current.support.canOff,
        )
    }

    fun requireOffSupport() { check(inspection?.support?.canOff == true) { "SUPPORT_NOT_VERIFIED" } }
}
