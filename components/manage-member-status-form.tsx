'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { updateMemberJoinDate } from '@/lib/actions';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface Member {
  id: string;
  full_name: string;
  phone_number: string;
  status: 'active' | 'completed' | 'defaulted';
  joined_at: string;
}

export function ManageMemberStatusForm({ schemeId }: { schemeId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchMembers = async () => {
      const supabase = createClient();

      try {
        const { data, error } = await supabase
          .from('scheme_members')
          .select(`
            id,
            status,
            joined_at,
            profiles (id, full_name, phone_number)
          `)
          .eq('scheme_id', schemeId)
          .order('status', { ascending: false });

        if (error) throw error;

        const transformedMembers = (data || []).map(item => {
          const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
          return {
            id: profile?.id || '',
            full_name: profile?.full_name || 'Unknown',
            phone_number: profile?.phone_number || 'N/A',
            status: item.status as 'active' | 'completed' | 'defaulted',
            joined_at: item.joined_at || '',
          };
        });

        setMembers(transformedMembers);
      } catch (err) {
        console.error('Error fetching members:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch members');
      } finally {
        setLoading(false);
      }
    };

    fetchMembers();
  }, [schemeId]);

  const handleStatusChange = async (memberId: string, newStatus: 'active' | 'completed' | 'defaulted') => {
    const supabase = createClient();

    try {
      const { error } = await supabase
        .from('scheme_members')
        .update({ status: newStatus })
        .eq('scheme_id', schemeId)
        .eq('user_id', memberId);

      if (error) throw error;

      setMembers(prev => prev.map(member =>
        member.id === memberId ? { ...member, status: newStatus } : member
      ));

      setSuccess('Status updated successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Error updating status:', err);
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const handleJoinDateChange = async (memberId: string, newDate: string) => {
    if (!newDate) return;

    const result = await updateMemberJoinDate({
      userId: memberId,
      schemeId,
      joinedAt: newDate,
    });

    if (result.error) {
      toast.error(result.error);
      return;
    }

    setMembers(prev => prev.map(member =>
      member.id === memberId ? { ...member, joined_at: new Date(newDate).toISOString() } : member
    ));
    toast.success('Join date updated successfully');
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-32">
        <p>Loading members...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Manage Member Statuses</CardTitle>
          <CardDescription>
            Update member statuses and contribution start dates. Adjust the &quot;Joined At&quot; date for members migrating from the manual system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {error && <p className="text-sm text-red-500">{error}</p>}
            {success && <p className="text-sm text-green-500">{success}</p>}

            {members.length === 0 ? (
              <p className="text-center py-4 text-muted-foreground">No members assigned to this scheme</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 text-left">Name</th>
                      <th className="py-2 text-left">Phone</th>
                      <th className="py-2 text-left">Joined At</th>
                      <th className="py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.id} className="border-b hover:bg-muted/50">
                        <td className="py-3">{member.full_name}</td>
                        <td className="py-3">{member.phone_number}</td>
                        <td className="py-3">
                          <Input
                            type="date"
                            className="w-[160px]"
                            defaultValue={member.joined_at ? new Date(member.joined_at).toISOString().split('T')[0] : ''}
                            onChange={(e) => handleJoinDateChange(member.id, e.target.value)}
                          />
                        </td>
                        <td className="py-3">
                          <Select
                            value={member.status}
                            onValueChange={(value: 'active' | 'completed' | 'defaulted') =>
                              handleStatusChange(member.id, value)
                            }
                          >
                            <SelectTrigger className="w-[140px]">
                              <SelectValue placeholder="Update status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                              <SelectItem value="defaulted">Defaulted</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
