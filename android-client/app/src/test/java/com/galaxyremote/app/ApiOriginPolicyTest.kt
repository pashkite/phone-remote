package com.galaxyremote.app
import org.junit.Assert.*
import org.junit.Test
class ApiOriginPolicyTest {
    @Test fun existingOriginsAndDefaultHttpsPortAreAccepted() {
        assertEquals("https://galaxy-remote-control.ashkite.chatgpt.site", ApiOriginPolicy.canonical(" https://galaxy-remote-control.ashkite.chatgpt.site/ "))
        assertEquals("https://remote.ashkite.kro.kr", ApiOriginPolicy.canonical("HTTPS://REMOTE.ASHKITE.KRO.KR:443/"))
    }
    @Test fun arbitraryDomainsAndTransportChangesAreRejected() {
        for (value in listOf("http://remote.ashkite.kro.kr", "https://new-qa.example", "https://remote.ashkite.kro.kr.attacker.example", "https://remote.ashkite.kro.kr:8443", "https://user@remote.ashkite.kro.kr", "https://remote.ashkite.kro.kr?token=secret", "https://remote.ashkite.kro.kr/#other", "https://remote.ashkite.kro.kr/api", "https://remote.ashkite.kro.kr/%2f", "https://remote.ashkite.kro.kr\\@attacker.example", "not a URL")) {
            try { ApiOriginPolicy.canonical(value); fail("unapproved origin accepted") } catch (_: IllegalArgumentException) { }
        }
    }
    @Test fun pairingCannotMoveCredentialsToAnotherOrigin() {
        val original="https://galaxy-remote-control.ashkite.chatgpt.site"
        assertEquals(original,ApiOriginPolicy.pairedOrigin(original, "$original/"))
        for (other in listOf("https://remote.ashkite.kro.kr", "https://attacker.example")) {
            try { ApiOriginPolicy.pairedOrigin(original,other); fail("credentials redirected") } catch (_: IllegalArgumentException) { }
        }
    }
    @Test fun existingCustomDomainRegistrationIsNotRewrittenToBuildDefault() {
        assertEquals("https://remote.ashkite.kro.kr",ApiOriginPolicy.canonical("https://remote.ashkite.kro.kr"))
    }
}
