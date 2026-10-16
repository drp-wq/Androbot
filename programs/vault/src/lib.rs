use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWxTWqkZ7FEfcYkgMQHGzFQqVjY");

pub const VAULT_SEED: &[u8] = b"vault";
pub const MAX_SLIPPAGE_BPS: u16 = 1_000; // Hard ceiling: 10%.

#[program]
pub mod vault {
    use super::*;

    /// Creates the per-authority vault and records its initial risk policy.
    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        validate_policy(&args.policy)?;
        require!(args.executor != Pubkey::default(), VaultError::InvalidExecutor);

        let now = Clock::get()?.unix_timestamp;
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.executor = args.executor;
        config.paused = true; // Fail closed: an operator must explicitly unpause.
        config.bump = ctx.bumps.config;
        config.max_position_lamports = args.policy.max_position_lamports;
        config.max_daily_loss_lamports = args.policy.max_daily_loss_lamports;
        config.max_open_positions = args.policy.max_open_positions;
        config.max_slippage_bps = args.policy.max_slippage_bps;
        config.created_at = now;
        config.updated_at = now;

        emit!(VaultInitialized {
            authority: config.authority,
            executor: config.executor,
            timestamp: now,
        });
        Ok(())
    }

    /// Anyone may top up the vault; the funds remain withdrawable only by its authority.
    pub fn deposit(ctx: Context<Deposit>, amount_lamports: u64) -> Result<()> {
        require!(amount_lamports > 0, VaultError::ZeroAmount);

        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor.to_account_info(),
            to: ctx.accounts.config.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts);
        system_program::transfer(cpi_ctx, amount_lamports)?;

        emit!(VaultDeposit {
            vault: ctx.accounts.config.key(),
            depositor: ctx.accounts.depositor.key(),
            amount_lamports,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Withdraws SOL while preserving the vault account's rent-exempt minimum.
    pub fn withdraw(ctx: Context<Withdraw>, amount_lamports: u64) -> Result<()> {
        require!(amount_lamports > 0, VaultError::ZeroAmount);

        let config_info = ctx.accounts.config.to_account_info();
        let authority_info = ctx.accounts.authority.to_account_info();
        let rent_reserve = Rent::get()?.minimum_balance(config_info.data_len());
        let spendable = config_info
            .lamports()
            .checked_sub(rent_reserve)
            .ok_or(VaultError::InsufficientFunds)?;
        require!(amount_lamports <= spendable, VaultError::InsufficientFunds);

        let new_vault_balance = config_info
            .lamports()
            .checked_sub(amount_lamports)
            .ok_or(VaultError::ArithmeticOverflow)?;
        let new_authority_balance = authority_info
            .lamports()
            .checked_add(amount_lamports)
            .ok_or(VaultError::ArithmeticOverflow)?;

        **config_info.try_borrow_mut_lamports()? = new_vault_balance;
        **authority_info.try_borrow_mut_lamports()? = new_authority_balance;

        emit!(VaultWithdrawal {
            vault: ctx.accounts.config.key(),
            authority: ctx.accounts.authority.key(),
            amount_lamports,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Updates risk settings. Only the recorded authority can change limits.
    pub fn update_policy(ctx: Context<UpdatePolicy>, policy: RiskPolicyArgs) -> Result<()> {
        validate_policy(&policy)?;
        let vault_key = ctx.accounts.config.key();
        let config = &mut ctx.accounts.config;
        config.max_position_lamports = policy.max_position_lamports;
        config.max_daily_loss_lamports = policy.max_daily_loss_lamports;
        config.max_open_positions = policy.max_open_positions;
        config.max_slippage_bps = policy.max_slippage_bps;
        config.updated_at = Clock::get()?.unix_timestamp;

        emit!(RiskPolicyUpdated {
            vault: vault_key,
            max_position_lamports: config.max_position_lamports,
            max_daily_loss_lamports: config.max_daily_loss_lamports,
            max_open_positions: config.max_open_positions,
            max_slippage_bps: config.max_slippage_bps,
            timestamp: config.updated_at,
        });
        Ok(())
    }

    /// The authority or configured executor may pause. Only the authority may unpause.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        let vault_key = ctx.accounts.config.key();
        let config = &mut ctx.accounts.config;
        let caller = ctx.accounts.operator.key();
        let is_authority = caller == config.authority;
        let is_executor = caller == config.executor;

        require!(is_authority || is_executor, VaultError::Unauthorized);
        require!(paused || is_authority, VaultError::OnlyAuthorityCanUnpause);

        config.paused = paused;
        config.updated_at = Clock::get()?.unix_timestamp;
        emit!(PauseStateChanged {
            vault: vault_key,
            paused,
            changed_by: caller,
            timestamp: config.updated_at,
        });
        Ok(())
    }
}

fn validate_policy(policy: &RiskPolicyArgs) -> Result<()> {
    require!(policy.max_position_lamports > 0, VaultError::InvalidPolicy);
    require!(policy.max_daily_loss_lamports > 0, VaultError::InvalidPolicy);
    require!(policy.max_open_positions > 0, VaultError::InvalidPolicy);
    require!(
        policy.max_slippage_bps > 0 && policy.max_slippage_bps <= MAX_SLIPPAGE_BPS,
        VaultError::InvalidSlippage
    );
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct RiskPolicyArgs {
    pub max_position_lamports: u64,
    pub max_daily_loss_lamports: u64,
    pub max_open_positions: u16,
    pub max_slippage_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct InitializeArgs {
    pub executor: Pubkey,
    pub policy: RiskPolicyArgs,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + VaultConfig::INIT_SPACE,
        seeds = [VAULT_SEED, authority.key().as_ref()],
        bump
    )]
    pub config: Account<'info, VaultConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [VAULT_SEED, config.authority.as_ref()], bump = config.bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, authority.key().as_ref()],
        bump = config.bump,
        has_one = authority @ VaultError::Unauthorized
    )]
    pub config: Account<'info, VaultConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, authority.key().as_ref()],
        bump = config.bump,
        has_one = authority @ VaultError::Unauthorized
    )]
    pub config: Account<'info, VaultConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds = [VAULT_SEED, config.authority.as_ref()], bump = config.bump)]
    pub config: Account<'info, VaultConfig>,
    pub operator: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct VaultConfig {
    pub authority: Pubkey,
    pub executor: Pubkey,
    pub paused: bool,
    pub bump: u8,
    pub max_position_lamports: u64,
    pub max_daily_loss_lamports: u64,
    pub max_open_positions: u16,
    pub max_slippage_bps: u16,
    pub created_at: i64,
    pub updated_at: i64,
}

#[event]
pub struct VaultInitialized {
    pub authority: Pubkey,
    pub executor: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct VaultDeposit {
    pub vault: Pubkey,
    pub depositor: Pubkey,
    pub amount_lamports: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultWithdrawal {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub amount_lamports: u64,
    pub timestamp: i64,
}

#[event]
pub struct RiskPolicyUpdated {
    pub vault: Pubkey,
    pub max_position_lamports: u64,
    pub max_daily_loss_lamports: u64,
    pub max_open_positions: u16,
    pub max_slippage_bps: u16,
    pub timestamp: i64,
}

#[event]
pub struct PauseStateChanged {
    pub vault: Pubkey,
    pub paused: bool,
    pub changed_by: Pubkey,
    pub timestamp: i64,
}

#[error_code]
pub enum VaultError {
    #[msg("The amount must be greater than zero.")]
    ZeroAmount,
    #[msg("The requested withdrawal exceeds spendable vault funds.")]
    InsufficientFunds,
    #[msg("The operation would overflow or underflow a numeric value.")]
    ArithmeticOverflow,
    #[msg("The caller is not authorized to perform this operation.")]
    Unauthorized,
    #[msg("Only the authority may unpause the vault.")]
    OnlyAuthorityCanUnpause,
    #[msg("The risk policy contains a zero or invalid limit.")]
    InvalidPolicy,
    #[msg("Slippage must be between 1 and 1000 basis points (10%).")]
    InvalidSlippage,
    #[msg("The executor public key must not be the default key.")]
    InvalidExecutor,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_policy() -> RiskPolicyArgs {
        RiskPolicyArgs {
            max_position_lamports: 1_000_000_000,
            max_daily_loss_lamports: 2_000_000_000,
            max_open_positions: 4,
            max_slippage_bps: 150,
        }
    }

    #[test]
    fn accepts_a_valid_policy() {
        assert!(validate_policy(&valid_policy()).is_ok());
    }

    #[test]
    fn rejects_zero_position_limit() {
        let mut policy = valid_policy();
        policy.max_position_lamports = 0;
        assert!(validate_policy(&policy).is_err());
    }

    #[test]
    fn rejects_zero_daily_loss_limit() {
        let mut policy = valid_policy();
        policy.max_daily_loss_lamports = 0;
        assert!(validate_policy(&policy).is_err());
    }

    #[test]
    fn rejects_zero_open_positions() {
        let mut policy = valid_policy();
        policy.max_open_positions = 0;
        assert!(validate_policy(&policy).is_err());
    }

    #[test]
    fn rejects_zero_slippage() {
        let mut policy = valid_policy();
        policy.max_slippage_bps = 0;
        assert!(validate_policy(&policy).is_err());
    }

    #[test]
    fn rejects_slippage_above_hard_ceiling() {
        let mut policy = valid_policy();
        policy.max_slippage_bps = MAX_SLIPPAGE_BPS + 1;
        assert!(validate_policy(&policy).is_err());
    }

    #[test]
    fn accepts_exact_slippage_ceiling() {
        let mut policy = valid_policy();
        policy.max_slippage_bps = MAX_SLIPPAGE_BPS;
        assert!(validate_policy(&policy).is_ok());
    }
}
