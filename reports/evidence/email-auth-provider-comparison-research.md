# Email auth provider comparison — research notes

**Дата сбора:** 2026-08-25 UTC  
**Назначение:** read-only source record для выбора provider-managed email/password auth. Это не подтверждение интеграции и не содержит credentials, user data или configuration values.

## Official sources reviewed

| Provider | Source | Retrieved facts relevant to Kairema |
|---|---|---|
| Stytch | [Consumer Authentication overview][1] | Consumer API/SDK path включает OAuth, password-based login/signup, sessions, MFA и risk/fraud capabilities. |
| Stytch | [Pricing][2] | Browser-verified 2026-08-25: pay-as-you-go с $0/мес., 10 000 MAU в free allowance и usage-based billing без hard cap после allowance. Полная email customization/brand removal указана как optional $99 add-on. |
| Supabase | [Password-based Auth][3] | Hosted email/password auth доступен, email confirmation по умолчанию включена; поддерживаются redirect URL, email templates и server-side PKCE token exchange pattern. |
| Supabase | [Identity Linking][4] | Есть automatic linking verified same-email identities и manual linking beta; docs отдельно предупреждают, что unverified email нельзя автоматически связывать из-за pre-account-takeover риска. |
| Supabase | [Pricing][5] | Browser-verified 2026-08-25: Free включает 50 000 MAU, 500 MB database, 1 GB storage и максимум два active projects; free project pauses после недели inactivity. Pro начинается от $25/мес. и включает первый project. |

## Security implications preserved for the decision

Stytch подходит как отдельный consumer auth service без переноса Kairema database. Browser-verified Consumer overview дополнительно подтверждает отдельные managed capabilities для OAuth, traditional password signup/login, sessions, MFA, bot/fraud protection и new-device notifications.[1] Official Stytch materials state that its automatic deduplication requires verified-email behavior and that it handles email delivery/provider failover; provider-specific email behavior still must be validated during implementation.[6] [7]

Supabase Auth также может быть использован как отдельный auth service, однако его automatic linking associates same-email identities with one user, while manual linking remains beta. Supabase documents verification measures to reduce pre-account-takeover risk, but this default remains incompatible with Kairema's requirement to avoid automatic linking based only on matching email. A Supabase route would require an explicit policy/configuration review before any implementation, not an assumption that automatic linking is safe for this project.[4]

Supabase server-side PKCE path потребует собственного confirm/token-exchange handler и redirect-template configuration. Stytch path потребует separate Consumer project/credentials and managed integration configuration. Ни один путь не разрешает добавлять local passwords, self-issued JWT, reset token storage или fictitious email delivery в Kairema.

## References

[1]: https://stytch.com/docs/consumer-auth/overview "Stytch Consumer Authentication overview"
[2]: https://stytch.com/pricing "Stytch pricing"
[3]: https://supabase.com/docs/guides/auth/passwords "Supabase password-based Auth"
[4]: https://supabase.com/docs/guides/auth/auth-identity-linking "Supabase Auth identity linking"
[5]: https://supabase.com/pricing "Supabase pricing"
[6]: https://stytch.com/b2c "Stytch Consumer Authentication"
[7]: https://stytch.com/blog/user-linking-and-provider-failover-with-stytch/ "Stytch user linking and provider failover"
