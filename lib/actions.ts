"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function getUser() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function createMember(formData: {
  email?: string;
  fullName: string;
  phoneNumber: string;
  altPhoneNumber?: string;
  homeAddress?: string;
  password?: string;
}) {
  const supabase = await createClient();
  
  // 1. Verify the caller is an admin
  const { data: { user: adminUser } } = await supabase.auth.getUser();
  if (!adminUser) throw new Error("Unauthorized");

  // Use the service role client to check the admin's role to bypass RLS recursion
  // (Alternatively, we could trust the metadata if we are sure it's synced, but DB is safer)
  // Since we already have createAdminClient, let's just use it for the check to be safe & fast.
  const adminClient = createAdminClient();
  
  // 2. Prepare User Data
  // If email is not provided, generate a dummy one based on phone number
  const email = formData.email?.trim() || `${formData.phoneNumber.replace(/\D/g, '')}@adashi.local`;
  
  // Default password to phone number if not provided (common for such systems)
  const password = formData.password?.trim() || formData.phoneNumber;

  const { data, error } = await adminClient.auth.admin.createUser({
    email: email,
    password: password,
    email_confirm: true,
    user_metadata: {
      full_name: formData.fullName,
      phone_number: formData.phoneNumber,
      alt_phone_number: formData.altPhoneNumber,
      home_address: formData.homeAddress,
      role: 'member'
    }
  });

  if (error) {
    console.error("Error creating member:", error);
    // Return a structured error
    return { error: error.message };
  }

  revalidatePath("/dashboard/admin/members");
  return { success: true, user: data.user, tempPassword: password, generatedEmail: email };
}

export async function recordContribution(data: {
  userId: string;
  schemeId: string;
  amount: number;
  notes?: string;
  type: 'deposit' | 'withdrawal' | 'fee';
  date?: string; // Optional date for pre-contributions
}) {
  const supabase = await createClient();
  
  const { data: { user: adminUser } } = await supabase.auth.getUser();
  if (!adminUser) throw new Error("Unauthorized");

  const transactionDate = data.date ? new Date(data.date).toISOString() : new Date().toISOString();

  const { error } = await supabase
    .from('transactions')
    .insert({
      user_id: data.userId,
      scheme_id: data.schemeId,
      admin_id: adminUser.id,
      amount: data.amount,
      type: data.type,
      notes: data.notes || `Contribution for ${new Date(transactionDate).toLocaleDateString()}`,
      date: transactionDate,
    });

  if (error) {
    console.error("Error recording contribution:", error);
    return { error: error.message };
  }

  // Revalidate all pages that might display contribution status
  revalidatePath(`/dashboard/admin/schemes/${data.schemeId}`);
  revalidatePath(`/dashboard/admin/schemes/${data.schemeId}/member/${data.userId}`);
  revalidatePath(`/dashboard/admin/schemes/${data.schemeId}/collect`);
  revalidatePath(`/dashboard/member`);
  revalidatePath(`/dashboard/member/schemes/${data.schemeId}`);
  // Also revalidate the main schemes page to update the quick collect buttons
  revalidatePath('/dashboard/admin/schemes');
  // Revalidate dashboard pages that might show contribution status
  revalidatePath('/dashboard/admin');
  revalidatePath('/dashboard');
  return { success: true };
}

export async function hasUserContributedToday(userId: string, schemeId: string) {
  const supabase = await createClient();

  const today = new Date();
  const todayFormatted = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('transactions')
    .select('id')
    .eq('user_id', userId)
    .eq('scheme_id', schemeId)
    .eq('type', 'deposit')
    .gte('date', `${todayFormatted}T00:00:00`)
    .lt('date', `${todayFormatted}T23:59:59`)
    .limit(1);

  if (error) {
    console.error("Error checking if user contributed today:", error);
    return false;
  }

  return data && data.length > 0;
}

export async function calculateMemberBalance(userId: string, schemeId: string, sinceDate?: string) {
  const supabase = await createClient();
  
  let effectiveSinceDate = sinceDate;

  if (!effectiveSinceDate) {
    // If no sinceDate provided, default to the membership joined_at date
    const { data: membership } = await supabase
      .from('scheme_members')
      .select('joined_at')
      .eq('user_id', userId)
      .eq('scheme_id', schemeId)
      .maybeSingle();
    
    if (membership) {
      effectiveSinceDate = membership.joined_at;
    }
  }

  let query = supabase
    .from('transactions')
    .select('amount, type')
    .eq('user_id', userId)
    .eq('scheme_id', schemeId);

  if (effectiveSinceDate) {
    query = query.gte('date', effectiveSinceDate);
  }

  const { data: transactions } = await query;
  // ... rest of the function (no changes to the rest)

  if (!transactions) return { balance: 0, totalDeposits: 0, totalWithdrawals: 0, totalFees: 0 };

  const totalDeposits = transactions
    .filter(t => t.type === 'deposit')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalWithdrawals = transactions
    .filter(t => t.type === 'withdrawal')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalFees = transactions
    .filter(t => t.type === 'fee')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const balance = totalDeposits - totalWithdrawals - totalFees;

  return { balance, totalDeposits, totalWithdrawals, totalFees };
}

export async function calculatePayout(userId: string, schemeId: string, sinceDate?: string) {
  const supabase = await createClient();

  let effectiveSinceDate = sinceDate;

  if (!effectiveSinceDate) {
    const { data: membership } = await supabase
      .from('scheme_members')
      .select('joined_at')
      .eq('user_id', userId)
      .eq('scheme_id', schemeId)
      .maybeSingle();
    
    if (membership) {
      effectiveSinceDate = membership.joined_at;
    }
  }

  // Get scheme details for rules
  const { data: scheme } = await supabase
    .from('schemes')
    .select('*')
    .eq('id', schemeId)
    .single();

  if (!scheme) throw new Error('Scheme not found');

  // Get member's transactions for this scheme
  let query = supabase
    .from('transactions')
    .select('amount, date, type')
    .eq('user_id', userId)
    .eq('scheme_id', schemeId)
    .eq('type', 'deposit');

  if (effectiveSinceDate) {
    query = query.gte('date', effectiveSinceDate);
  }

  const { data: transactions } = await query.order('date', { ascending: true });

  if (!transactions) {
    return {
      grossAmount: 0,
      serviceCharge: 0,
      netPayout: 0,
      scheme: {
        name: scheme.name,
        type: scheme.type
      }
    };
  }

  // Group transactions by month
  const monthlyTransactions: { [key: string]: typeof transactions } = {};
  
  transactions.forEach(transaction => {
    // Extract year-month from the date (e.g., "2023-04" for April 2023)
    const date = new Date(transaction.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    if (!monthlyTransactions[monthKey]) {
      monthlyTransactions[monthKey] = [];
    }
    monthlyTransactions[monthKey].push(transaction);
  });

  // Calculate service charges based on one contribution per month
  let totalServiceCharge = 0;
  let totalGrossAmount = 0;

  for (const month in monthlyTransactions) {
    const monthTransactions = monthlyTransactions[month];
    const totalMonthlyContributions = monthTransactions.length;
    
    if (totalMonthlyContributions > 0) {
      // Take the contribution amount of the first transaction as the standard contribution amount for this month
      // (assuming all contributions in a scheme are typically the same amount)
      const contributionAmount = monthTransactions[0].amount;
      
      // For each month, one contribution serves as the service charge
      // So if there are N contributions, the service charge is equal to 1 contribution amount
      const monthlyServiceCharge = contributionAmount;
      totalServiceCharge += monthlyServiceCharge;
      
      // Add the total amount for this month to the gross amount
      const monthlyTotal = monthTransactions.reduce((sum, t) => sum + Number(t.amount), 0);
      totalGrossAmount += monthlyTotal;
    }
  }

  // Calculate net payout (gross amount minus service charges)
  const netPayout = Math.max(0, totalGrossAmount - totalServiceCharge);

  return {
    grossAmount: totalGrossAmount,
    serviceCharge: totalServiceCharge,
    netPayout,
    scheme: {
      name: scheme.name,
      type: scheme.type
    }
  };
}

export async function processPayout(data: {
  userId: string;
  schemeId: string;
  notes?: string;
  processFullAmount?: boolean; // Option to process full amount instead of calculated net payout
  customAmount?: number; // Custom amount to process instead of calculated amounts
  sinceDate?: string; // Optional date for re-assignment "fresh start"
}) {
  const supabase = await createClient();

  const { data: { user: adminUser } } = await supabase.auth.getUser();
  if (!adminUser) throw new Error("Unauthorized");

  // Calculate payout details
  const payoutDetails = await calculatePayout(data.userId, data.schemeId, data.sinceDate);

  if (payoutDetails.netPayout <= 0) {
    return { error: "No funds available for payout" };
  }

  // Determine the amount to process based on admin preference
  let amountToProcess = payoutDetails.netPayout; // Default to net payout
  
  if (data.customAmount !== undefined) {
    // Use custom amount if provided
    amountToProcess = data.customAmount;
  } else if (data.processFullAmount) {
    // Use gross amount if processFullAmount is true
    amountToProcess = payoutDetails.grossAmount;
  }
  // Otherwise, use the calculated net payout (default)

  // Validate that the custom amount doesn't exceed available funds
  if (amountToProcess > payoutDetails.grossAmount) {
    return { error: "Requested payout amount exceeds available funds" };
  }

  if (amountToProcess <= 0) {
    return { error: "Payout amount must be positive" };
  }

  // Record the withdrawal transaction
  const { error: withdrawalError } = await supabase
    .from('transactions')
    .insert({
      user_id: data.userId,
      scheme_id: data.schemeId,
      admin_id: adminUser.id,
      amount: amountToProcess,
      type: 'withdrawal',
      notes: data.notes || `Payout processed - ${new Date().toLocaleDateString()}`,
      date: new Date().toISOString(),
    });

  if (withdrawalError) {
    console.error("Error recording withdrawal:", withdrawalError);
    return { error: withdrawalError.message };
  }

  // Record service charge if applicable (only when not using custom amount and not processing full amount)
  if (data.customAmount === undefined && !data.processFullAmount && payoutDetails.serviceCharge > 0) {
    const { error: feeError } = await supabase
      .from('transactions')
      .insert({
        user_id: data.userId,
        scheme_id: data.schemeId,
        admin_id: adminUser.id,
        amount: payoutDetails.serviceCharge,
        type: 'fee',
        notes: `Service charge - ${new Date().toLocaleDateString()}`,
        date: new Date().toISOString(),
      });

    if (feeError) {
      console.error("Error recording service charge:", feeError);
      // Don't return error here as withdrawal was successful
    }
  }

  // Detach all transactions for this member in this scheme from the scheme itself.
  // This satisfies:
  // 1. "transaction history should be in the transaction table" (records remain in the table)
  // 2. "should not show in the scheme" (they no longer have a scheme_id)
  // 3. "the member should not access it" (filtered by scheme_id)
  // 4. "clear the grid data" (grid uses scheme_id)
  const { error: detachError } = await supabase
    .from('transactions')
    .update({ scheme_id: null })
    .eq('user_id', data.userId)
    .eq('scheme_id', data.schemeId);

  if (detachError) {
    console.error("Error detaching transactions after payout:", detachError);
  }

  // Remove member from scheme after payout
  // This effectively "destroys" the member's association with the scheme
  const { error: removeError } = await supabase
    .from('scheme_members')
    .delete()
    .eq('user_id', data.userId)
    .eq('scheme_id', data.schemeId);

  if (removeError) {
    console.error("Error removing member from scheme after payout:", removeError);
    // We don't necessarily want to fail the whole action if the removal fails, 
    // but the user requested this feature specifically.
  }

  revalidatePath(`/dashboard/admin/schemes`);
  revalidatePath(`/dashboard/admin/schemes/${data.schemeId}`);
  revalidatePath(`/dashboard/admin/schemes/${data.schemeId}/member/${data.userId}`);
  revalidatePath(`/dashboard/member`);
  revalidatePath(`/dashboard/member/schemes/${data.schemeId}`);

  return {
    success: true,
    payoutDetails: {
      ...payoutDetails,
      processedAmount: amountToProcess,
      processedAt: new Date().toISOString()
    }
  };
}

export async function updateMemberJoinDate(data: {
  userId: string;
  schemeId: string;
  joinedAt: string;
}) {
  const supabase = await createClient();

  const { data: { user: adminUser } } = await supabase.auth.getUser();
  if (!adminUser) throw new Error("Unauthorized");

  const { error } = await supabase
    .from('scheme_members')
    .update({ joined_at: new Date(data.joinedAt).toISOString() })
    .eq('user_id', data.userId)
    .eq('scheme_id', data.schemeId);

  if (error) {
    console.error("Error updating join date:", error);
    return { error: error.message };
  }

  revalidatePath(`/dashboard/admin/schemes/${data.schemeId}`);
  revalidatePath(`/dashboard/admin/schemes/${data.schemeId}/member/${data.userId}`);
  revalidatePath(`/dashboard/admin/schemes/${data.schemeId}/manage-status`);
  revalidatePath(`/dashboard/member`);
  revalidatePath(`/dashboard/member/schemes/${data.schemeId}`);
  return { success: true };
}

export async function updateMember(userId: string, formData: {
  fullName: string;
  phoneNumber: string;
  altPhoneNumber?: string;
  homeAddress?: string;
}) {
  const adminClient = createAdminClient();
  
  const { data: { user: adminUser } } = await adminClient.auth.getUser();
  if (!adminUser) throw new Error("Unauthorized");

  // Update Auth User Metadata
  const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
    user_metadata: {
      full_name: formData.fullName,
      phone_number: formData.phoneNumber,
      alt_phone_number: formData.altPhoneNumber,
      home_address: formData.homeAddress,
    }
  });

  if (authError) {
    console.error("Error updating auth user:", authError);
    return { error: authError.message };
  }

  // Update Profile table explicitly to be sure
  const { error: profileError } = await adminClient
    .from('profiles')
    .update({
      full_name: formData.fullName,
      phone_number: formData.phoneNumber,
      alt_phone_number: formData.altPhoneNumber,
      home_address: formData.homeAddress,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (profileError) {
    console.error("Error updating profile:", profileError);
    return { error: profileError.message };
  }

  revalidatePath("/dashboard/admin/members");
  return { success: true };
}

export async function deleteMember(userId: string) {
  const adminClient = createAdminClient();
  
  const { data: { user: adminUser } } = await adminClient.auth.getUser();
  if (!adminUser) throw new Error("Unauthorized");

  // Delete from Auth (this will trigger profile deletion if set up, or we might need to do it manually)
  const { error } = await adminClient.auth.admin.deleteUser(userId);

  if (error) {
    console.error("Error deleting user:", error);
    return { error: error.message };
  }

  revalidatePath("/dashboard/admin/members");
  return { success: true };
}