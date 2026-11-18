<?php
declare(strict_types=1);
require_once __DIR__ . '/inventory.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

function bookili_billing_date(mixed $value): DateTimeImmutable
{
    $date = bookili_calendar_date($value);
    if ($date->format('Y-m-d') < '2000-01-01' || $date->format('Y-m-d') > bookili_now()->modify('+5 years')->format('Y-m-d')) {
        bookili_json_response(422, ['error' => 'Date de facturation invalide.']);
    }
    return $date;
}

try {
    $pdo = bookili_database();
    $admin = bookili_require_role($pdo, ['super_admin']);
    if ($method === 'POST') {
        $action = $data['action'] ?? null;
        if ($action === 'save-plan') {
            $id = isset($data['id']) ? bookili_id($data['id']) : null;
            $name = bookili_required_text($data, 'name', 120);
            $monthly = bookili_inventory_integer($data, 'monthlyPrice', 100000000);
            $annual = bookili_inventory_integer($data, 'annualPrice', 100000000);
            $trial = bookili_inventory_integer($data, 'trialDays', 365);
            $active = $data['isActive'] ?? null;
            if (!is_bool($active) || $monthly === 0 && $annual === 0) bookili_json_response(422, ['error' => 'Activez le forfait et définissez un tarif mensuel ou annuel.']);
            if ($id === null) {
                $pdo->prepare(
                    'INSERT INTO subscription_plans (name, monthly_price_dzd, annual_price_dzd, trial_days, is_active)
                     VALUES (:name, :monthly, :annual, :trial, :active)'
                )->execute(['name' => $name, 'monthly' => $monthly, 'annual' => $annual, 'trial' => $trial, 'active' => (int) $active]);
            } else {
                $pdo->prepare(
                    'UPDATE subscription_plans SET name = :name, monthly_price_dzd = :monthly,
                     annual_price_dzd = :annual, trial_days = :trial, is_active = :active WHERE id = :id'
                )->execute(['name' => $name, 'monthly' => $monthly, 'annual' => $annual, 'trial' => $trial, 'active' => (int) $active, 'id' => $id]);
            }
            bookili_json_response(200, ['message' => 'Forfait enregistré.']);
        }
        if ($action === 'assign') {
            $accountId = bookili_id($data['accountId'] ?? null);
            $planId = bookili_id($data['planId'] ?? null);
            $cycle = $data['cycle'] ?? null;
            if (!in_array($cycle, ['monthly', 'annual'], true)) bookili_json_response(422, ['error' => 'Cycle invalide.']);
            $pdo->beginTransaction();
            $statement = $pdo->prepare(
                "SELECT pp.id FROM professional_profiles pp
                 INNER JOIN accounts a ON a.id = pp.account_id
                 WHERE a.id = :id AND a.role = 'professional' AND a.status = 'active' FOR UPDATE"
            );
            $statement->execute(['id' => $accountId]);
            $profileId = $statement->fetchColumn();
            if (!$profileId) {
                $pdo->rollBack();
                bookili_json_response(404, ['error' => 'Compte professionnel actif introuvable.']);
            }
            $statement = $pdo->prepare('SELECT trial_days, monthly_price_dzd, annual_price_dzd FROM subscription_plans WHERE id = :id AND is_active = 1');
            $statement->execute(['id' => $planId]);
            $plan = $statement->fetch();
            if (!$plan || (int) $plan[$cycle === 'annual' ? 'annual_price_dzd' : 'monthly_price_dzd'] < 1) {
                $pdo->rollBack();
                bookili_json_response(404, ['error' => 'Forfait actif avec ce cycle de facturation introuvable.']);
            }
            $statement = $pdo->prepare('SELECT id FROM professional_subscriptions WHERE professional_profile_id = :profile FOR UPDATE');
            $statement->execute(['profile' => $profileId]);
            if ($statement->fetchColumn()) {
                $pdo->rollBack();
                bookili_json_response(409, ['error' => 'Ce professionnel possède déjà un abonnement. La réattribution est désactivée pour préserver son historique.']);
            }
            $today = bookili_now()->format('Y-m-d');
            $trialDays = (int) $plan['trial_days'];
            $end = $trialDays > 0
                ? bookili_now()->modify('+' . $trialDays . ' days')->format('Y-m-d')
                : $today;
            $status = (int) $trialDays > 0 ? 'trial' : 'past_due';
            $now = bookili_now()->format('Y-m-d H:i:s');
            $pdo->prepare(
                'INSERT INTO professional_subscriptions
                 (professional_profile_id, plan_id, billing_cycle, price_dzd, status, period_start, period_end, created_at, updated_at)
                 VALUES (:profile, :plan, :cycle, :price, :status, :start, :end, :now, :now_update)'
            )->execute([
                'profile' => $profileId, 'plan' => $planId, 'cycle' => $cycle, 'status' => $status,
                'price' => (int) $plan[$cycle === 'annual' ? 'annual_price_dzd' : 'monthly_price_dzd'],
                'start' => $today, 'end' => $end, 'now' => $now, 'now_update' => $now,
            ]);
            $pdo->commit();
            bookili_json_response(200, ['message' => $status === 'trial' ? 'Forfait attribué avec période d’essai.' : 'Forfait attribué en attente du premier règlement.']);
        }
        if ($action === 'record-payment') {
            $subscriptionId = bookili_id($data['subscriptionId'] ?? null);
            $amount = bookili_inventory_integer($data, 'amountDzd', 100000000, 1);
            $method = $data['paymentMethod'] ?? null;
            $reference = bookili_required_text($data, 'reference', 120);
            if (!in_array($method, ['cash', 'transfer', 'card', 'other'], true)) bookili_json_response(422, ['error' => 'Mode de règlement invalide.']);
            $start = bookili_billing_date($data['periodStart'] ?? null);
            $end = bookili_billing_date($data['periodEnd'] ?? null);
            if ($end < $start || $end > $start->modify('+1 year +1 month')) bookili_json_response(422, ['error' => 'Période de règlement invalide.']);
            $pdo->beginTransaction();
            $statement = $pdo->prepare(
                'SELECT s.id, s.billing_cycle, s.price_dzd, s.status
                 FROM professional_subscriptions s
                 WHERE s.id = :id FOR UPDATE'
            );
            $statement->execute(['id' => $subscriptionId]);
            $subscription = $statement->fetch();
            $expected = $subscription ? (int) $subscription['price_dzd'] : 0;
            $expectedEnd = $subscription
                ? $start->modify($subscription['billing_cycle'] === 'annual' ? '+1 year -1 day' : '+1 month -1 day')
                : null;
            if (!$subscription || $amount !== $expected || $end->format('Y-m-d') !== $expectedEnd->format('Y-m-d')) {
                $pdo->rollBack();
                bookili_json_response(422, ['error' => 'Le montant et la période doivent correspondre au forfait attribué.']);
            }
            if (($subscription['billing_cycle'] === 'monthly' && $start->format('d') !== '01')
                || ($subscription['billing_cycle'] === 'annual' && $start->format('m-d') !== '01-01')) {
                $pdo->rollBack();
                bookili_json_response(422, ['error' => 'Les périodes mensuelles commencent le premier du mois et les périodes annuelles le 1er janvier.']);
            }
            if ($subscription['status'] === 'cancelled') {
                $pdo->rollBack();
                bookili_json_response(409, ['error' => 'Un abonnement annulé ne peut pas recevoir de nouveau règlement.']);
            }
            $statement = $pdo->prepare('SELECT 1 FROM subscription_payments WHERE subscription_id = :id AND reference = :reference');
            $statement->execute(['id' => $subscriptionId, 'reference' => $reference]);
            if ($statement->fetchColumn()) {
                $pdo->rollBack();
                bookili_json_response(409, ['error' => 'Cette référence de règlement a déjà été enregistrée pour ce forfait.']);
            }
            $statement = $pdo->prepare(
                'SELECT 1 FROM subscription_payments
                 WHERE subscription_id = :subscription AND period_start <= :period_end AND period_end >= :period_start'
            );
            $statement->execute([
                'subscription' => $subscriptionId, 'period_end' => $end->format('Y-m-d'),
                'period_start' => $start->format('Y-m-d'),
            ]);
            if ($statement->fetchColumn()) {
                $pdo->rollBack();
                bookili_json_response(409, ['error' => 'Un règlement existe déjà pour tout ou partie de cette période.']);
            }
            $now = bookili_now()->format('Y-m-d H:i:s');
            $pdo->prepare(
                'INSERT INTO subscription_payments
                 (subscription_id, recorded_by, amount_dzd, payment_method, reference, period_start, period_end, paid_at, created_at)
                 VALUES (:subscription, :admin, :amount, :method, :reference, :start, :end, :paid, :created)'
            )->execute([
                'subscription' => $subscriptionId, 'admin' => $admin['id'], 'amount' => $amount,
                'method' => $method, 'reference' => $reference, 'start' => $start->format('Y-m-d'),
                'end' => $end->format('Y-m-d'), 'paid' => $now, 'created' => $now,
            ]);
            $pdo->prepare(
                "UPDATE professional_subscriptions SET status = 'active', period_start = :start,
                 period_end = :end, updated_at = :updated WHERE id = :id"
            )->execute(['start' => $start->format('Y-m-d'), 'end' => $end->format('Y-m-d'), 'updated' => $now, 'id' => $subscriptionId]);
            $pdo->commit();
            bookili_json_response(201, ['paymentId' => (int) $pdo->lastInsertId(), 'message' => 'Règlement enregistré. Aucun prélèvement n’a été effectué.']);
        }
        bookili_json_response(422, ['error' => 'Action de facturation invalide.']);
    }

    $pdo->prepare(
        "UPDATE professional_subscriptions SET status = 'past_due', updated_at = :updated
         WHERE status = 'trial' AND period_end < :today"
    )->execute(['updated' => bookili_now()->format('Y-m-d H:i:s'), 'today' => bookili_now()->format('Y-m-d')]);
    $plans = $pdo->query('SELECT * FROM subscription_plans ORDER BY is_active DESC, id')->fetchAll();
    $subscriptions = $pdo->query(
        'SELECT s.id, s.billing_cycle, s.price_dzd, s.status, s.period_start, s.period_end, p.name AS plan_name,
                a.id AS account_id, a.email, pr.display_name, sa.name AS salon_name
         FROM professional_subscriptions s
         INNER JOIN professional_profiles pr ON pr.id = s.professional_profile_id
         INNER JOIN accounts a ON a.id = pr.account_id
         INNER JOIN subscription_plans p ON p.id = s.plan_id
         LEFT JOIN salons sa ON sa.professional_profile_id = pr.id
         ORDER BY s.period_end, a.email LIMIT 200'
    )->fetchAll();
    $professionals = $pdo->query(
        "SELECT a.id, a.email, pr.display_name FROM accounts a
         INNER JOIN professional_profiles pr ON pr.account_id = a.id
         WHERE a.role = 'professional' AND a.status = 'active'
         ORDER BY a.email LIMIT 500"
    )->fetchAll();
    $payments = $pdo->query(
        'SELECT sp.id, sp.amount_dzd, sp.payment_method, sp.reference, sp.period_start, sp.period_end,
                sp.paid_at, a.email
         FROM subscription_payments sp
         INNER JOIN professional_subscriptions s ON s.id = sp.subscription_id
         INNER JOIN professional_profiles p ON p.id = s.professional_profile_id
         INNER JOIN accounts a ON a.id = p.account_id
         ORDER BY sp.paid_at DESC, sp.id DESC LIMIT 50'
    )->fetchAll();
    bookili_json_response(200, ['plans' => $plans, 'subscriptions' => $subscriptions, 'professionals' => $professionals, 'payments' => $payments]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
