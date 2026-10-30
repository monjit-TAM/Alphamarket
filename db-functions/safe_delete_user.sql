CREATE OR REPLACE FUNCTION safe_delete_user(target_user_id text) RETURNS void AS $$
BEGIN
  -- Delete calls & positions for user's strategies first
  DELETE FROM calls WHERE strategy_id IN (SELECT id FROM strategies WHERE advisor_id = target_user_id);
  DELETE FROM positions WHERE strategy_id IN (SELECT id FROM strategies WHERE advisor_id = target_user_id);

  -- Delete all direct child records (both advisor_id and user_id references)
  DELETE FROM advisor_bank_details WHERE advisor_id = target_user_id;
  DELETE FROM advisor_microsites WHERE advisor_id = target_user_id;
  DELETE FROM advisor_payments WHERE advisor_id = target_user_id;
  DELETE FROM advisor_questions WHERE advisor_id = target_user_id OR user_id = target_user_id;
  DELETE FROM advisor_recommendations WHERE advisor_id = target_user_id OR investor_id = target_user_id;
  DELETE FROM broker_advisor_mappings WHERE advisor_id = target_user_id;
  DELETE FROM broker_basket_publish_log WHERE advisor_id = target_user_id OR triggered_by_user_id = target_user_id;
  DELETE FROM content WHERE advisor_id = target_user_id;
  DELETE FROM customer_portfolios WHERE user_id = target_user_id;
  DELETE FROM ekyc_verifications WHERE advisor_id = target_user_id OR user_id = target_user_id;
  DELETE FROM esign_agreements WHERE advisor_id = target_user_id OR user_id = target_user_id;
  DELETE FROM financial_goals WHERE created_by = target_user_id OR user_id = target_user_id;
  DELETE FROM password_reset_tokens WHERE user_id = target_user_id;
  DELETE FROM payments WHERE advisor_id = target_user_id OR user_id = target_user_id;
  DELETE FROM plans WHERE advisor_id = target_user_id;
  DELETE FROM pmla_verifications WHERE user_id = target_user_id;
  DELETE FROM portfolio_suggestions WHERE advisor_id = target_user_id;
  DELETE FROM push_subscriptions WHERE user_id = target_user_id;
  DELETE FROM risk_profiles WHERE advisor_id = target_user_id OR user_id = target_user_id;
  DELETE FROM scores WHERE advisor_id = target_user_id;
  DELETE FROM subscriptions WHERE advisor_id = target_user_id OR user_id = target_user_id;
  DELETE FROM telegram_linking_codes WHERE user_id = target_user_id;
  DELETE FROM telegram_subscriptions WHERE user_id = target_user_id;
  DELETE FROM tool_subscriptions WHERE user_id = target_user_id;
  DELETE FROM tool_usage WHERE user_id = target_user_id;
  DELETE FROM user_access_grants WHERE granted_by = target_user_id OR user_id = target_user_id;
  DELETE FROM watchlist WHERE user_id = target_user_id;
  DELETE FROM xts_publish_log WHERE advisor_id = target_user_id;

  -- Delete strategies last (after calls/positions)
  DELETE FROM strategies WHERE advisor_id = target_user_id;

  -- Finally delete the user
  DELETE FROM users WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql;
